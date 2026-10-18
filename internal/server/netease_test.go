package server

import (
	"context"
	"ef-teaparty/internal/netease"
	"ef-teaparty/internal/party"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

type musicCaller struct {
	fn func(string, map[string]any) (any, error)
}

func (m musicCaller) Ready() error { return nil }
func (m musicCaller) Close() error { return nil }
func (m musicCaller) Call(_ context.Context, method string, params any, out any) error {
	response, err := m.fn(method, params.(map[string]any))
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(response)
	return json.Unmarshal(raw, out)
}

type musicTransport func(*http.Request) (*http.Response, error)

func (fn musicTransport) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

func TestNeteaseRoutesVisibilityRangeAndArchive(t *testing.T) {
	root := t.TempDir()
	song := func(id string, hidden bool) party.Media {
		return party.Media{ID: "m" + id, Kind: "audio", URL: "/api/netease/audio/" + id, Netease: &party.NeteaseSource{SongID: id}, AnswerOnly: hidden}
	}
	store, err := party.Open(filepath.Join(root, "state.json"), party.Config{Settings: party.Settings{Title: "Music"}, Questions: []party.Question{
		{ID: "warmup", Kind: "warmup", Title: "Music", Enabled: true, Media: []party.Media{song("1", false), song("2", true)}},
		{ID: "next", Kind: "warmup", Title: "Next", Enabled: true, Media: []party.Media{song("3", false), song("4", false)}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	service := netease.NewService(musicCaller{fn: func(method string, p map[string]any) (any, error) {
		if method == "health" {
			return map[string]any{"ready": true}, nil
		}
		return map[string]any{"code": 200, "data": []any{map[string]any{"id": p["id"], "code": 200, "url": "https://m801.music.126.net/song.mp3", "expi": 1200, "freeTrialInfo": nil}}}, nil
	}}, filepath.Join(root, "netease"))
	transport := musicTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("credentials forwarded to CDN")
		}
		rr := httptest.NewRecorder()
		http.ServeContent(rr, r, "song.mp3", zeroMusicTime, strings.NewReader("0123456789"))
		return rr.Result(), nil
	})
	handler := New(store, "music-password", filepath.Join(root, "media"), t.TempDir(), t.TempDir(), WithNetease(service), func(s *Server) { s.neteaseHTTP = &http.Client{Transport: transport} })
	srv := httptest.NewServer(handler)
	defer srv.Close()
	for _, path := range []string{"/api/admin/netease/status", "/api/admin/netease/playlists"} {
		r, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 401 {
			t.Fatalf("admin endpoint exposed: %s %d", path, r.StatusCode)
		}
	}
	for _, tc := range []struct {
		id   string
		code int
	}{{"1", 200}, {"2", 404}, {"3", 200}, {"4", 404}, {"999", 404}} {
		r, err := http.Get(srv.URL + "/api/netease/audio/" + tc.id)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != tc.code {
			t.Fatalf("song %s status=%d want=%d", tc.id, r.StatusCode, tc.code)
		}
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/netease/audio/1", nil)
	req.Header.Set("Range", "bytes=2-5")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 206 || string(raw) != "2345" || r.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range failure: %d %s %s", r.StatusCode, raw, r.Header.Get("Content-Range"))
	}
	r, err = http.Head(srv.URL + "/api/netease/audio/1")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != 200 || len(raw) != 0 || r.ContentLength != 10 {
		t.Fatalf("HEAD failure: %d %d %d", r.StatusCode, len(raw), r.ContentLength)
	}
	login, err := http.Post(srv.URL+"/api/login", "application/json", strings.NewReader(`{"password":"music-password"}`))
	if err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	cookie := login.Cookies()[0]
	req, _ = http.NewRequest("GET", srv.URL+"/api/netease/audio/999", nil)
	req.AddCookie(cookie)
	r, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatalf("unsaved admin preview unavailable: %d", r.StatusCode)
	}
	if !archiveExternal("/api/netease/audio/1") || archiveExternal("/api/netease/audio/1?cookie=secret") {
		t.Fatal("online source archive classification")
	}
	req, _ = http.NewRequest("GET", srv.URL+"/api/admin/archive", nil)
	req.AddCookie(cookie)
	r, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = io.ReadAll(r.Body)
	r.Body.Close()
	archive := filepath.Join(root, "activity.zip")
	if err := writeMusicArchive(archive, raw); err != nil {
		t.Fatal(err)
	}
	restored, manifest, summary, err := inspectArchiveFile(context.Background(), archive)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.External) != 4 || len(summary.Unavailable) != 0 || len(manifest.Assets) != 4 || restored.Config.Questions[0].Media[0].Netease.SongID != "1" {
		t.Fatalf("online reference roundtrip: %+v %+v", summary, restored.Config.Questions[0].Media)
	}
}
