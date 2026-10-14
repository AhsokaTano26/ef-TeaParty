package server

import (
	"ef-teaparty/internal/party"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClockEndpointAndFreshHTML(t *testing.T) {
	s, err := party.Open(filepath.Join(t.TempDir(), "state.json"), party.Config{Settings: party.Settings{Title: "test"}, Questions: []party.Question{{ID: "one", Kind: "intro", Title: "hello", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	web := t.TempDir()
	if err := os.WriteFile(filepath.Join(web, "index.html"), []byte("current-frontend"), 0600); err != nil {
		t.Fatal(err)
	}
	handler := New(s, "test-password", t.TempDir(), t.TempDir(), web)
	before := time.Now().UnixMilli()
	r := httptest.NewRecorder()
	handler.ServeHTTP(r, httptest.NewRequest("GET", "/api/time", nil))
	var clock struct {
		ServerTime int64 `json:"serverTime"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &clock); err != nil {
		t.Fatal(err)
	}
	if r.Code != http.StatusOK || clock.ServerTime < before || clock.ServerTime > time.Now().UnixMilli() {
		t.Fatal("clock endpoint does not expose the live server clock")
	}
	if s.Snapshot().ServerTime < before {
		t.Fatal("admin snapshot does not include server time")
	}
	for _, path := range []string{"/", "/stage"} {
		r = httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Header().Get("Cache-Control") != "no-store" || r.Body.String() != "current-frontend" {
			t.Fatalf("%s retained a stale frontend", path)
		}
	}
}
