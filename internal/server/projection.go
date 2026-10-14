package server

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	projectionLimit    = 64
	projectionTTL      = 2 * time.Minute
	projectionInterval = 500 * time.Millisecond
)

type projectionMedia struct {
	ID         string  `json:"id"`
	Seq        int64   `json:"seq"`
	Phase      string  `json:"phase"`
	ReadyState int     `json:"readyState"`
	Position   float64 `json:"position"`
	Duration   float64 `json:"duration"`
	Drift      float64 `json:"drift"`
	Muted      bool    `json:"muted"`
}

type projectionReport struct {
	ClientID     string           `json:"clientId"`
	QuestionID   string           `json:"questionId"`
	Revision     int64            `json:"revision"`
	Connected    bool             `json:"connected"`
	Visible      bool             `json:"visible"`
	Fullscreen   bool             `json:"fullscreen"`
	SoundEnabled bool             `json:"soundEnabled"`
	Media        *projectionMedia `json:"media"`
}

type projectionClient struct {
	projectionReport
	LastSeen int64 `json:"lastSeen"`
}

type projectionRegistry struct {
	mu      sync.Mutex
	clients map[string]projectionClient
	window  time.Time
	reports int
}

var projectionClientID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

func validProjectionReport(v projectionReport) bool {
	if !projectionClientID.MatchString(v.ClientID) || len(v.QuestionID) > 100 || strings.ContainsAny(v.QuestionID, "\n\r\x00") || v.Revision < 0 {
		return false
	}
	if v.Media == nil {
		return true
	}
	m := v.Media
	if m.ID == "" || len(m.ID) > 100 || strings.ContainsAny(m.ID, "\n\r\x00") || m.Seq < 0 || m.ReadyState < 0 || m.ReadyState > 4 {
		return false
	}
	switch m.Phase {
	case "loading", "ready", "buffering", "playing", "paused", "ended", "error", "blocked":
	default:
		return false
	}
	for _, n := range []float64{m.Position, m.Duration, m.Drift} {
		if math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > 1e9 {
			return false
		}
	}
	return m.Position >= 0 && m.Duration >= 0
}

func (p *projectionRegistry) expire(now time.Time) {
	for id, c := range p.clients {
		if now.Sub(time.UnixMilli(c.LastSeen)) >= projectionTTL {
			delete(p.clients, id)
		}
	}
}

func (p *projectionRegistry) put(v projectionReport, now time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.expire(now)
	if p.clients == nil {
		p.clients = map[string]projectionClient{}
	}
	if now.Sub(p.window) >= time.Second {
		p.window, p.reports = now, 0
	}
	if p.reports >= 128 {
		return false
	}
	p.reports++
	if old, ok := p.clients[v.ClientID]; ok {
		if now.Sub(time.UnixMilli(old.LastSeen)) < projectionInterval {
			return false
		}
	} else if len(p.clients) >= projectionLimit {
		return false
	}
	p.clients[v.ClientID] = projectionClient{projectionReport: v, LastSeen: now.UnixMilli()}
	return true
}

func (p *projectionRegistry) list(now time.Time) []projectionClient {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.expire(now)
	clients := make([]projectionClient, 0, len(p.clients))
	for _, c := range p.clients {
		clients = append(clients, c)
	}
	sort.Slice(clients, func(i, j int) bool {
		if clients[i].LastSeen == clients[j].LastSeen {
			return clients[i].ClientID < clients[j].ClientID
		}
		return clients[i].LastSeen > clients[j].LastSeen
	})
	return clients
}

// Reports are ephemeral: they never commit party state, increment a revision,
// or cause SSE broadcasts. The public endpoint only acknowledges a write.
func (s *Server) registerProjectionRoutes(mux *http.ServeMux) {
	registry := &projectionRegistry{}
	mux.HandleFunc("POST /api/projection/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Host != r.Host || (u.Scheme != "http" && u.Scheme != "https") {
				respond(w, http.StatusForbidden, map[string]string{"error": "禁止跨站上报"})
				return
			}
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			respond(w, http.StatusForbidden, map[string]string{"error": "禁止跨站上报"})
			return
		}
		mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaType != "application/json" {
			respond(w, http.StatusUnsupportedMediaType, map[string]string{"error": "请使用 JSON 上报"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var report projectionReport
		err := decoder.Decode(&report)
		if err == nil && decoder.Decode(new(any)) != io.EOF {
			err = fmt.Errorf("multiple objects")
		}
		if err != nil || !validProjectionReport(report) {
			respond(w, http.StatusBadRequest, map[string]string{"error": "投影状态无效"})
			return
		}
		if !registry.put(report, time.Now()) {
			w.Header().Set("Retry-After", "2")
			respond(w, http.StatusTooManyRequests, map[string]string{"error": "上报过于频繁，请稍后重试"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("GET /api/admin/projections", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		now := time.Now()
		respond(w, http.StatusOK, struct {
			ServerTime int64              `json:"serverTime"`
			Clients    []projectionClient `json:"clients"`
		}{ServerTime: now.UnixMilli(), Clients: registry.list(now)})
	})))
}
