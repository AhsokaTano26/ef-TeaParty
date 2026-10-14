package server

import (
	"archive/zip"
	"bytes"
	"context"
	"ef-teaparty/internal/party"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func archiveFixture(t *testing.T) (*Server, *http.ServeMux, *http.Cookie) {
	t.Helper()
	media, assets := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(assets, "ppt"), 0700); err != nil {
		t.Fatal(err)
	}
	for file, body := range map[string][]byte{filepath.Join(media, "secret.mp3"): []byte("ID3\x00answer"), filepath.Join(media, "figure.png"): []byte("\x89PNG\r\n\x1a\nfigure"), filepath.Join(assets, "ppt", "bg.png"): []byte("\x89PNG\r\n\x1a\nbackground")} {
		if err := os.WriteFile(file, body, 0600); err != nil {
			t.Fatal(err)
		}
	}
	store, err := party.Open(filepath.Join(t.TempDir(), "state.json"), party.Config{Settings: party.Settings{Title: "Portable", Background: "/assets/ppt/bg.png"}, Teams: []party.Team{{ID: "a", Name: "A", Color: "#ff6699"}}, Questions: []party.Question{{ID: "page", Kind: "intro", Title: "Welcome", Enabled: true, Media: []party.Media{{ID: "answer", Kind: "audio", URL: "/media/secret.mp3", AnswerOnly: true}, {ID: "remote", Kind: "image", URL: "https://example.invalid/photo.png"}, {ID: "missing", Kind: "image", URL: "/media/missing.png"}}, Illustrations: []party.Illustration{{ID: "art", URL: "/media/figure.png", X: 20, Y: 20, Width: 20, Layer: "front"}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Apply(party.Action{Op: "adjust", TeamID: "a", Delta: 8}); err != nil {
		t.Fatal(err)
	}
	s := &Server{store: store, media: media, assets: assets, web: t.TempDir(), sessions: map[string]time.Time{"admin": time.Now().Add(time.Hour), "other": time.Now().Add(time.Hour)}}
	mux := http.NewServeMux()
	s.registerArchiveRoutes(mux)
	return s, mux, &http.Cookie{Name: "party_session", Value: "admin"}
}
func archiveRequest(mux http.Handler, cookie *http.Cookie, method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, body)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	result := httptest.NewRecorder()
	mux.ServeHTTP(result, req)
	return result
}
func inspectArchive(t *testing.T, mux http.Handler, cookie *http.Cookie, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = writer.Close()
	result := archiveRequest(mux, cookie, "POST", "/api/admin/archive/inspect", &body, writer.FormDataContentType())
	if result.Code == 200 {
		var value struct {
			Token string `json:"token"`
		}
		if json.Unmarshal(result.Body.Bytes(), &value) == nil {
			t.Cleanup(func() { archiveRequest(mux, cookie, "DELETE", "/api/admin/archive/inspect/"+value.Token, nil, "") })
		}
	}
	return result
}
func TestArchiveRoundTripIncludesPrivateMediaAndRestoresInNewNamespace(t *testing.T) {
	s, mux, cookie := archiveFixture(t)
	download := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "")
	if download.Code != 200 {
		t.Fatal(download.Code, download.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(download.Body.Bytes()), int64(download.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	manifestBytes := []byte{}
	for _, entry := range zr.File {
		if entry.Name == "manifest.json" {
			f, _ := entry.Open()
			manifestBytes, _ = io.ReadAll(f)
			_ = f.Close()
		}
	}
	if !bytes.Contains(manifestBytes, []byte("secret.mp3")) || !bytes.Contains(manifestBytes, []byte("external")) || !bytes.Contains(manifestBytes, []byte("unavailable")) {
		t.Fatal("manifest must disclose answer media, external links and missing files")
	}
	inspected := inspectArchive(t, mux, cookie, download.Body.Bytes())
	if inspected.Code != 200 {
		t.Fatal(inspected.Code, inspected.Body.String())
	}
	var result struct {
		Token    string `json:"token"`
		Revision int64  `json:"revision"`
	}
	if err = json.Unmarshal(inspected.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(result)
	restored := archiveRequest(mux, cookie, "POST", "/api/admin/archive/restore", bytes.NewReader(payload), "application/json")
	if restored.Code != 200 {
		t.Fatal(restored.Code, restored.Body.String())
	}
	state := s.store.Snapshot()
	if state.TeamScore("a") != 8 || !strings.HasPrefix(state.Config.Settings.Background, "/media/restored-") {
		t.Fatal("state or references were not restored")
	}
	url := state.Config.Questions[0].Media[0].URL
	data, err := os.ReadFile(filepath.Join(s.media, strings.TrimPrefix(url, "/media/")))
	if err != nil || string(data) != "ID3\x00answer" {
		t.Fatal("answer-only media was not restored", err)
	}
	if state.Config.Questions[0].Media[1].URL != "https://example.invalid/photo.png" {
		t.Fatal("external link rewritten")
	}
	if _, err = os.Stat(filepath.Join(s.media, "secret.mp3")); err != nil {
		t.Fatal("existing media removed")
	}
}
func TestArchiveAuthSessionBindingAndStalePreview(t *testing.T) {
	s, mux, cookie := archiveFixture(t)
	if got := archiveRequest(mux, nil, "GET", "/api/admin/archive", nil, ""); got.Code != 401 {
		t.Fatal("archive leaked without authentication")
	}
	download := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "")
	preview := inspectArchive(t, mux, cookie, download.Body.Bytes())
	var result map[string]any
	_ = json.Unmarshal(preview.Body.Bytes(), &result)
	payload, _ := json.Marshal(map[string]any{"token": result["token"], "revision": result["revision"]})
	other := &http.Cookie{Name: "party_session", Value: "other"}
	if got := archiveRequest(mux, other, "POST", "/api/admin/archive/restore", bytes.NewReader(payload), "application/json"); got.Code != 404 {
		t.Fatal("preview token usable by another session", got.Code)
	}
	if err := s.store.Apply(party.Action{Op: "adjust", TeamID: "a", Delta: 5}); err != nil {
		t.Fatal(err)
	}
	if got := archiveRequest(mux, cookie, "POST", "/api/admin/archive/restore", bytes.NewReader(payload), "application/json"); got.Code != 409 {
		t.Fatal("stale restore accepted", got.Code, got.Body.String())
	}
	if s.store.Snapshot().TeamScore("a") != 13 {
		t.Fatal("stale restore overwrote current scores")
	}
	paths, _ := filepath.Glob(filepath.Join(s.media, "restored-*"))
	if len(paths) > 0 {
		t.Fatal("failed restore leaked new namespace")
	}
}
func TestArchiveRejectsTraversalDuplicateSymlinkAndCorruption(t *testing.T) {
	_, mux, cookie := archiveFixture(t)
	for _, name := range []string{"../escape", "/absolute", "folder\\evil", "same", "symlink"} {
		t.Run(name, func(t *testing.T) {
			var data bytes.Buffer
			zw := zip.NewWriter(&data)
			h := &zip.FileHeader{Name: name}
			if name == "symlink" {
				h.SetMode(os.ModeSymlink | 0777)
			}
			f, _ := zw.CreateHeader(h)
			_, _ = f.Write([]byte("invalid"))
			if name == "same" {
				f, _ = zw.Create(name)
				_, _ = f.Write([]byte("again"))
			}
			_ = zw.Close()
			r := inspectArchive(t, mux, cookie, data.Bytes())
			if r.Code != 400 {
				t.Fatal("unsafe archive accepted", r.Code, r.Body.String())
			}
		})
	}
	if r := inspectArchive(t, mux, cookie, []byte("not zip")); r.Code != 400 {
		t.Fatal("invalid ZIP accepted")
	}
	original := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "").Body.Bytes()
	mutated := bytes.Replace(original, []byte("ID3\x00answer"), []byte("ID3\x00broken"), 1)
	if r := inspectArchive(t, mux, cookie, mutated); r.Code != 400 {
		t.Fatal("checksum mismatch accepted", r.Code, r.Body.String())
	}
}

type interruptedArchiveWriter struct {
	header  http.Header
	written int
	largest int
}

func (w *interruptedArchiveWriter) Header() http.Header { return w.header }
func (w *interruptedArchiveWriter) WriteHeader(int)     {}
func (w *interruptedArchiveWriter) Write(data []byte) (int, error) {
	if len(data) > w.largest {
		w.largest = len(data)
	}
	w.written += len(data)
	if w.written > 256<<10 {
		return 0, io.ErrClosedPipe
	}
	return len(data), nil
}
func TestArchiveStreamsThreeGiBMediaAndStopsOnDisconnect(t *testing.T) {
	s, _, cookie := archiveFixture(t)
	f, err := os.Create(filepath.Join(s.media, "large.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(3 << 30); err != nil {
		f.Close()
		t.Fatal(err)
	}
	_ = f.Close()
	cfg := s.store.Snapshot().Config
	cfg.Questions[0].Media = []party.Media{{ID: "large", Kind: "video", URL: "/media/large.mp4"}}
	if err = s.store.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/admin/archive", nil)
	req.AddCookie(cookie)
	result := &interruptedArchiveWriter{header: http.Header{}}
	s.downloadArchive(result, req)
	if result.header.Get("Content-Type") != "application/zip" || result.written < 256<<10 {
		t.Fatal("3 GiB media was excluded from streamed archive")
	}
	if result.largest > 128<<10 || result.written > 512<<10 {
		t.Fatal("archive was not written in bounded chunks or ignored disconnect")
	}
}
func TestArchiveRejectsZipBombAndCancelsPreview(t *testing.T) {
	_, mux, cookie := archiveFixture(t)
	var data bytes.Buffer
	zw := zip.NewWriter(&data)
	entry, _ := zw.Create("files/bomb.mp4")
	_, _ = io.Copy(entry, io.LimitReader(zeroArchiveReader{}, 2<<20))
	_ = zw.Close()
	if got := inspectArchive(t, mux, cookie, data.Bytes()); got.Code != 400 {
		t.Fatal("ZIP bomb accepted")
	}
	download := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "")
	inspect := inspectArchive(t, mux, cookie, download.Body.Bytes())
	var parsed struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(inspect.Body.Bytes(), &parsed)
	cancelled := archiveRequest(mux, cookie, "DELETE", "/api/admin/archive/inspect/"+parsed.Token, nil, "")
	if cancelled.Code != 200 {
		t.Fatal("preview cancellation failed")
	}
	if again := archiveRequest(mux, cookie, "POST", "/api/admin/archive/restore", strings.NewReader(`{"token":"`+parsed.Token+`","revision":2}`), "application/json"); again.Code != 404 {
		t.Fatal("cancelled token could restore")
	}
}

type zeroArchiveReader struct{}

func (zeroArchiveReader) Read(b []byte) (int, error) { clear(b); return len(b), nil }
func TestArchiveDoesNotFollowLocalSymlinks(t *testing.T) {
	s, mux, cookie := archiveFixture(t)
	private := filepath.Join(t.TempDir(), "private.png")
	if err := os.WriteFile(private, []byte("private-file-content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(private, filepath.Join(s.media, "linked.png")); err != nil {
		t.Fatal(err)
	}
	cfg := s.store.Snapshot().Config
	cfg.Settings.Background = "/media/linked.png"
	if err := s.store.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	result := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "")
	if bytes.Contains(result.Body.Bytes(), []byte("private-file-content")) {
		t.Fatal("archive followed a symlink outside public media")
	}
	if inspected := inspectArchive(t, mux, cookie, result.Body.Bytes()); inspected.Code != 200 {
		t.Fatal("missing symlink should remain an explicit unavailable reference", inspected.Body.String())
	}
}

func TestArchiveRejectsTamperedAssetEvenWithUpdatedZipCRC(t *testing.T) {
	_, mux, cookie := archiveFixture(t)
	original := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "").Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(original), int64(len(original)))
	if err != nil {
		t.Fatal(err)
	}
	var tampered bytes.Buffer
	zw := zip.NewWriter(&tampered)
	for _, entry := range zr.File {
		reader, e := entry.Open()
		if e != nil {
			t.Fatal(e)
		}
		content, _ := io.ReadAll(reader)
		reader.Close()
		if strings.HasSuffix(entry.Name, ".mp3") {
			content = []byte("ID3\x00broken")
		}
		output, e := zw.CreateHeader(&zip.FileHeader{Name: entry.Name, Method: zip.Store})
		if e != nil {
			t.Fatal(e)
		}
		_, _ = output.Write(content)
	}
	if err = zw.Close(); err != nil {
		t.Fatal(err)
	}
	result := inspectArchive(t, mux, cookie, tampered.Bytes())
	if result.Code != 400 || !strings.Contains(result.Body.String(), "素材校验失败") {
		t.Fatal("SHA256 did not detect changed asset with valid ZIP CRC", result.Body.String())
	}
}

func TestArchiveRejectsHugeCentralDirectoryBeforeAllocation(t *testing.T) {
	_, mux, cookie := archiveFixture(t)
	data := append([]byte(nil), archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "").Body.Bytes()...)
	offset := bytes.LastIndex(data, []byte{0x50, 0x4b, 0x05, 0x06})
	if offset < 0 {
		t.Fatal("missing zip directory")
	}
	data[offset+10] = 0x11
	data[offset+11] = 0x27 // 10001 entries.
	result := inspectArchive(t, mux, cookie, data)
	if result.Code != 400 || !strings.Contains(result.Body.String(), "数量") {
		t.Fatal("unbounded directory was accepted", result.Body.String())
	}
}

func TestArchiveCanceledRestoreRemovesOnlyNewAssets(t *testing.T) {
	s, mux, cookie := archiveFixture(t)
	original := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "").Body.Bytes()
	preview := inspectArchive(t, mux, cookie, original)
	var parsed struct {
		Token    string `json:"token"`
		Revision int64  `json:"revision"`
	}
	if err := json.Unmarshal(preview.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(parsed)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest("POST", "/api/admin/archive/restore", bytes.NewReader(body)).WithContext(ctx)
	req.AddCookie(cookie)
	result := httptest.NewRecorder()
	mux.ServeHTTP(result, req)
	if result.Code != 400 {
		t.Fatal("canceled restore unexpectedly succeeded", result.Code)
	}
	if s.store.Snapshot().TeamScore("a") != 8 || s.store.Snapshot().Revision != parsed.Revision {
		t.Fatal("cancellation changed active state")
	}
	if _, err := os.Stat(filepath.Join(s.media, "secret.mp3")); err != nil {
		t.Fatal("cancellation removed original asset")
	}
	paths, _ := filepath.Glob(filepath.Join(s.media, "restored-*"))
	if len(paths) != 0 {
		t.Fatal("cancellation leaked restore namespace")
	}
}
