package server

import (
	"ef-teaparty/internal/party"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthAndPublicRoutes(t *testing.T) {
	s, e := party.Open(filepath.Join(t.TempDir(), "state.json"), party.Config{Settings: party.Settings{Title: "test"}, Questions: []party.Question{{ID: "one", Kind: "intro", Title: "hello", Enabled: true}}})
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewServer(New(s, "test-password", t.TempDir(), t.TempDir(), t.TempDir()))
	defer srv.Close()
	r, e := http.Get(srv.URL + "/api/admin/state")
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatal("unauthenticated admin")
	}
	r, e = http.Get(srv.URL + "/api/state")
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatal("public stage unavailable")
	}
	r, e = http.Post(srv.URL+"/api/login", "application/json", strings.NewReader(`{"password":"wrong"}`))
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatal("wrong password accepted")
	}
	r, e = http.Post(srv.URL+"/api/login", "application/json", strings.NewReader(`{"password":"test-password"}`))
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 200 || len(r.Cookies()) == 0 {
		t.Fatal("login failed")
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/admin/state", nil)
	req.AddCookie(r.Cookies()[0])
	r, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != 200 || !strings.Contains(string(b), "hello") {
		t.Fatal("authenticated state failed")
	}
	req, _ = http.NewRequest("POST", srv.URL+"/api/admin/action", strings.NewReader(`{"op":"reveal"}`))
	req.AddCookie(&http.Cookie{Name: "party_session", Value: "forged"})
	r, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	r.Body.Close()
	if r.StatusCode != 401 {
		t.Fatal("forged token accepted")
	}
}

func TestStaticAssetsAndMediaRanges(t *testing.T) {
	s, err := party.Open(filepath.Join(t.TempDir(), "state.json"), party.Config{Settings: party.Settings{Title: "test"}, Questions: []party.Question{{ID: "one", Kind: "intro", Title: "hello", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	media, assets, web := t.TempDir(), t.TempDir(), t.TempDir()
	for _, d := range []string{filepath.Join(assets, "ppt"), filepath.Join(web, "assets")} {
		if err := os.Mkdir(d, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for path, body := range map[string]string{filepath.Join(assets, "seed.json"): "private-answer-bank", filepath.Join(assets, "ppt", "background.png"): "picture", filepath.Join(web, "assets", "index.js"): "javascript", filepath.Join(media, "clip.mp3"): "0123456789"} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	srv := httptest.NewServer(New(s, "test-password", media, assets, web))
	defer srv.Close()
	for _, path := range []string{"/assets/seed.json", "/assets/ppt/", "/media/"} {
		r, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("%s exposed: %d", path, r.StatusCode)
		}
	}
	for _, path := range []string{"/assets/index.js", "/assets/ppt/background.png"} {
		r, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("%s unavailable: %d", path, r.StatusCode)
		}
	}
	req, _ := http.NewRequest("GET", srv.URL+"/media/clip.mp3", nil)
	req.Header.Set("Range", "bytes=2-5")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	body, _ := io.ReadAll(r.Body)
	if r.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Fatalf("media seeking failed: %d %s", r.StatusCode, body)
	}
}
