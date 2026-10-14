package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ef-teaparty/internal/party"
)

type uploadZeros struct{}

func (uploadZeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func mediaRequest(t *testing.T, filename string, size int64) *http.Request {
	t.Helper()
	var form bytes.Buffer
	m := multipart.NewWriter(&form)
	if _, err := m.CreateFormFile("file", filename); err != nil {
		t.Fatal(err)
	}
	header := bytes.Clone(form.Bytes())
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	tail := bytes.Clone(form.Bytes()[len(header):])
	body := io.MultiReader(bytes.NewReader(header), io.LimitReader(uploadZeros{}, size), bytes.NewReader(tail))
	r := httptest.NewRequest(http.MethodPost, "/api/admin/upload", body)
	r.Header.Set("Content-Type", m.FormDataContentType())
	r.ContentLength = int64(len(header)) + size + int64(len(tail))
	return r
}

func TestUploadVideoLargerThanOldLimit(t *testing.T) {
	dir := t.TempDir()
	s := &Server{media: dir}
	w := httptest.NewRecorder()
	const size = int64(256<<20) + 1
	s.upload(w, mediaRequest(t, "concert.MP4", size))
	if w.Code != http.StatusOK {
		t.Fatalf("video above 256 MB was rejected: %d %s", w.Code, w.Body.String())
	}
	var media party.Media
	if err := json.Unmarshal(w.Body.Bytes(), &media); err != nil {
		t.Fatal(err)
	}
	f, err := os.Stat(filepath.Join(dir, filepath.Base(media.URL)))
	if err != nil || f.Size() != size || media.Kind != "video" {
		t.Fatalf("large video was not saved completely: %v %+v", err, media)
	}
}

func TestUploadRejectsRequestAboveThreeGBWithoutReading(t *testing.T) {
	s := &Server{media: t.TempDir()}
	r := mediaRequest(t, "concert.mp4", 1)
	r.ContentLength = 3<<30 + 2<<20
	r.Body = noUploadRead{t}
	w := httptest.NewRecorder()
	s.upload(w, r)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized request status: %d %s", w.Code, w.Body.String())
	}
}

type noUploadRead struct{ t *testing.T }

func (r noUploadRead) Read([]byte) (int, error) {
	r.t.Fatal("oversized request was read before rejection")
	return 0, io.EOF
}
func (noUploadRead) Close() error { return nil }

func TestOversizedImageIsRejectedAndPartialFileRemoved(t *testing.T) {
	dir := t.TempDir()
	s := &Server{media: dir}
	r := mediaRequest(t, "background.png", 256<<20+1)
	r.ContentLength = -1
	w := httptest.NewRecorder()
	s.upload(w, r)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized image status: %d %s", w.Code, w.Body.String())
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatalf("partial upload was left on disk: %v %v", files, err)
	}
}
