package server

import (
	"ef-teaparty/internal/party"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func validProjectionFixture() projectionReport {
	return projectionReport{ClientID: "test_projection_1234", QuestionID: "one", Revision: 4, Connected: true, Media: &projectionMedia{ID: "video", Seq: 1, Phase: "playing", ReadyState: 4, Position: 20, Duration: 120, Drift: -.12}}
}

func TestProjectionPayloadValidation(t *testing.T) {
	if !validProjectionReport(validProjectionFixture()) {
		t.Fatal("valid status rejected")
	}
	for name, mutate := range map[string]func(*projectionReport){
		"short client":   func(v *projectionReport) { v.ClientID = "a" },
		"large question": func(v *projectionReport) { v.QuestionID = strings.Repeat("x", 101) },
		"revision":       func(v *projectionReport) { v.Revision = -1 },
		"phase":          func(v *projectionReport) { v.Media.Phase = "invented" },
		"readiness":      func(v *projectionReport) { v.Media.ReadyState = 5 },
		"position":       func(v *projectionReport) { v.Media.Position = -1 },
		"nan":            func(v *projectionReport) { v.Media.Drift = math.NaN() },
		"infinity":       func(v *projectionReport) { v.Media.Duration = math.Inf(1) },
	} {
		t.Run(name, func(t *testing.T) {
			v := validProjectionFixture()
			mutate(&v)
			if validProjectionReport(v) {
				t.Fatal("invalid status accepted")
			}
		})
	}
}

func TestProjectionRegistryExpiryRateAndCapacity(t *testing.T) {
	p := &projectionRegistry{}
	now := time.Unix(1000, 0)
	v := validProjectionFixture()
	if !p.put(v, now) || p.put(v, now.Add(100*time.Millisecond)) {
		t.Fatal("heartbeat throttling failed")
	}
	for i := 1; i < projectionLimit; i++ {
		v.ClientID = fmt.Sprintf("projection_client_%03d", i)
		if !p.put(v, now) {
			t.Fatal("registry filled too early")
		}
	}
	v.ClientID = "projection_client_overflow"
	if p.put(v, now) {
		t.Fatal("unbounded registry")
	}
	if len(p.list(now.Add(projectionTTL-time.Millisecond))) != projectionLimit {
		t.Fatal("expired too soon")
	}
	if len(p.list(now.Add(projectionTTL))) != 0 {
		t.Fatal("expired clients retained")
	}
	if !p.put(v, now.Add(projectionTTL)) {
		t.Fatal("expired registry did not free capacity")
	}
}

func TestProjectionRoutesWriteOnlyAndAdminRead(t *testing.T) {
	s := &Server{sessions: map[string]time.Time{"session": time.Now().Add(time.Hour)}}
	mux := http.NewServeMux()
	s.registerProjectionRoutes(mux)
	valid, _ := json.Marshal(validProjectionFixture())
	request := func(method, path, body, origin, contentType string, admin bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", contentType)
		r.Header.Set("Origin", origin)
		if admin {
			r.AddCookie(&http.Cookie{Name: "party_session", Value: "session"})
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	if w := request("POST", "/api/projection/status", string(valid), "", "application/json", false); w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("public acknowledgement exposed data: %d %s", w.Code, w.Body)
	}
	if w := request("POST", "/api/projection/status", string(valid), "", "application/json", false); w.Code != 429 {
		t.Fatal("rapid repeat accepted")
	}
	if w := request("GET", "/api/projection/status", "", "", "", false); w.Code != 405 {
		t.Fatal("public read exposed")
	}
	if w := request("GET", "/api/admin/projections", "", "", "", false); w.Code != 401 {
		t.Fatal("unauthenticated read accepted")
	}
	if w := request("GET", "/api/admin/projections", "", "", "", true); w.Code != 200 || !strings.Contains(w.Body.String(), "test_projection_1234") {
		t.Fatal("admin status unavailable")
	}
	for _, tc := range []struct {
		body, origin, contentType string
		code                      int
	}{
		{string(valid), "https://evil.example", "application/json", 403},
		{string(valid), "", "text/plain", 415},
		{`{"clientId":"test_projection_1234","answer":"secret"}`, "", "application/json", 400},
		{string(valid) + ` {}`, "", "application/json", 400},
		{`{"clientId":"` + strings.Repeat("a", 5000) + `"}`, "", "application/json", 400},
	} {
		if w := request("POST", "/api/projection/status", tc.body, tc.origin, tc.contentType, false); w.Code != tc.code {
			t.Fatalf("got %d want %d", w.Code, tc.code)
		}
	}
}

func TestProjectionReportsDoNotMutatePartyState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := party.Open(path, party.Config{Settings: party.Settings{Title: "test"}, Questions: []party.Question{{ID: "one", Kind: "intro", Title: "private admin title", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	revision := store.Snapshot().Revision
	updates, unsubscribe := store.Subscribe()
	defer unsubscribe()
	server := &Server{store: store}
	mux := http.NewServeMux()
	server.registerProjectionRoutes(mux)
	body, _ := json.Marshal(validProjectionFixture())
	req := httptest.NewRequest("POST", "/api/projection/status", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if w.Code != 204 || w.Body.Len() != 0 || string(before) != string(after) || store.Snapshot().Revision != revision {
		t.Fatal("ephemeral heartbeat changed party state or exposed data")
	}
	select {
	case <-updates:
		t.Fatal("heartbeat triggered a party SSE update")
	default:
	}
}
