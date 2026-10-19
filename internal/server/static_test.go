package server

import (
	"bytes"
	"compress/gzip"
	"ef-teaparty/internal/party"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestStaticAssetEncodingAndCache(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("const greeting = 'hello';\n", 100)
	name := "/assets/index-Abc123_x.js"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	z := gzip.NewWriter(&compressed)
	_, _ = z.Write([]byte(body))
	_ = z.Close()
	if err := os.WriteFile(filepath.Join(dir, name+".gz"), compressed.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "plain.js"), []byte("plain"), 0600)
	store, err := party.Open(filepath.Join(t.TempDir(), "state.json"), party.Config{Settings: party.Settings{Title: "test"}, Questions: []party.Question{{ID: "one", Kind: "intro", Title: "hello", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	h := New(store, "password", t.TempDir(), t.TempDir(), dir)
	for _, tc := range []struct {
		encoding   string
		compressed bool
	}{
		{"", false}, {"gzip", true}, {"br, gzip", true}, {"GZIP;Q=1", true}, {"gzip;q=0", false}, {"gzip;q=0, *;q=1", false}, {"*;q=0.5", true}, {"gzip;q=oops", false},
	} {
		t.Run(tc.encoding, func(t *testing.T) {
			r := httptest.NewRequest("GET", name, nil)
			r.Header.Set("Accept-Encoding", tc.encoding)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 {
				t.Fatalf("status %d", w.Code)
			}
			if w.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
				t.Fatalf("hashed asset cache: %s", w.Header().Get("Cache-Control"))
			}
			if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
				t.Fatal("encoding missing from Vary")
			}
			got := w.Body.Bytes()
			if tc.compressed {
				if w.Header().Get("Content-Encoding") != "gzip" {
					t.Fatal("gzip was not negotiated")
				}
				z, err := gzip.NewReader(bytes.NewReader(got))
				if err != nil {
					t.Fatal(err)
				}
				got, err = io.ReadAll(z)
				if err != nil {
					t.Fatal(err)
				}
				_ = z.Close()
			} else if w.Header().Get("Content-Encoding") != "" {
				t.Fatal("unacceptable encoding")
			}
			if string(got) != body || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
				t.Fatal("content changed or incorrect MIME")
			}
		})
	}
	for _, method := range []string{"GET", "HEAD"} {
		r := httptest.NewRequest(method, name, nil)
		r.Header.Set("Accept-Encoding", "gzip")
		r.Header.Set("Range", "bytes=0-9")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 206 || w.Header().Get("Content-Encoding") != "" || w.Header().Get("Content-Range") != "bytes 0-9/2600" {
			t.Fatalf("range: %d %v", w.Code, w.Header())
		}
		if method == "GET" && w.Body.String() != body[:10] {
			t.Fatal("wrong range")
		}
		if method == "HEAD" && w.Body.Len() != 0 {
			t.Fatal("HEAD returned a body")
		}
	}
	head := httptest.NewRecorder()
	r := httptest.NewRequest("HEAD", name, nil)
	r.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(head, r)
	if head.Header().Get("Content-Encoding") != "gzip" || head.Body.Len() != 0 {
		t.Fatal("encoded HEAD")
	}

	if head.Header().Get("Content-Length") != strconv.Itoa(compressed.Len()) {
		t.Fatalf("encoded HEAD length: %q, want %d", head.Header().Get("Content-Length"), compressed.Len())
	}
	for _, path := range []string{"/", "/stage", "/api/state", "/plain.js", "/assets/missing-Abc123_x.js"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatalf("cached mutable or missing path %s", path)
		}
	}
	_ = os.Remove(filepath.Join(dir, name+".gz"))
	w := httptest.NewRecorder()
	r = httptest.NewRequest("GET", name, nil)
	r.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != body || w.Header().Get("Content-Encoding") != "" {
		t.Fatal("missing gzip fallback")
	}
}
