package server

import (
	"ef-teaparty/internal/netease"
	"ef-teaparty/internal/party"
	"errors"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) musicOwner(r *http.Request) string {
	c, err := r.Cookie("party_session")
	if err != nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.sessions[c.Value].After(time.Now()) {
		return ""
	}
	return c.Value
}
func musicError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	kind := "network"
	var problem *netease.Error
	if errors.As(err, &problem) {
		kind = problem.Kind
		switch kind {
		case "invalid":
			status = 400
		case "login":
			status = 409
		case "unavailable", "preview":
			status = 422
		case "canceled":
			status = 404
		case "auth":
			status = 401
		case "storage":
			status = 500
		}
	}
	respond(w, status, map[string]string{"error": err.Error(), "kind": kind})
}
func musicOffset(r *http.Request) (int, error) {
	raw := r.URL.Query().Get("offset")
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 100000 {
		return 0, &netease.Error{Kind: "invalid", Message: "歌单分页位置无效"}
	}
	return value, nil
}
func (s *Server) registerNeteaseRoutes(mux *http.ServeMux) {
	admin := func(pattern string, h http.HandlerFunc) {
		mux.Handle(pattern, s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if s.netease == nil {
				if r.URL.Path == "/api/admin/netease/status" {
					respond(w, 200, netease.Status{Message: "网易云组件未启用，请更新并重启服务"})
					return
				}
				respond(w, 503, map[string]string{"error": "网易云组件未启用，请更新并重启服务"})
				return
			}
			h(w, r)
		})))
	}
	admin("GET /api/admin/netease/status", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.netease.Status(r.Context())
		if err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, v)
	})
	admin("POST /api/admin/netease/login", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.netease.StartLogin(r.Context(), s.musicOwner(r))
		if err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, v)
	})
	admin("GET /api/admin/netease/login/{task}", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.netease.CheckLogin(r.Context(), s.musicOwner(r), r.PathValue("task"))
		if err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, v)
	})
	admin("DELETE /api/admin/netease/login/{task}", func(w http.ResponseWriter, r *http.Request) {
		s.netease.CancelLogin(s.musicOwner(r), r.PathValue("task"))
		respond(w, 200, map[string]bool{"ok": true})
	})
	admin("DELETE /api/admin/netease/account", func(w http.ResponseWriter, r *http.Request) {
		if err := s.netease.Logout(); err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	admin("GET /api/admin/netease/playlists", func(w http.ResponseWriter, r *http.Request) {
		offset, err := musicOffset(r)
		if err != nil {
			musicError(w, err)
			return
		}
		v, err := s.netease.Playlists(r.Context(), offset)
		if err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, v)
	})
	admin("POST /api/admin/netease/import", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Input  string `json:"input"`
			Offset int    `json:"offset"`
		}
		if err := decode(w, r, &request); err != nil {
			respond(w, 400, map[string]string{"error": err.Error()})
			return
		}
		v, err := s.netease.Import(r.Context(), request.Input, request.Offset)
		if err != nil {
			musicError(w, err)
			return
		}
		respond(w, 200, v)
	})
	admin("GET /api/admin/netease/tracks/{songId}/availability", func(w http.ResponseWriter, r *http.Request) {
		stream, err := s.netease.Resolve(r.Context(), r.PathValue("songId"))
		if err != nil {
			musicError(w, err)
			return
		}
		if !validNeteaseCDN(stream.URL) {
			respond(w, 502, map[string]string{"error": "网易云返回了不支持的音频地址", "kind": "unavailable"})
			return
		}
		respond(w, 200, map[string]any{"ready": true, "detail": "可获取完整歌曲，仍需在投影端试播确认"})
	})
	mux.HandleFunc("GET /api/netease/audio/{songId}", s.neteaseAudio)
}
func (s *Server) musicVisible(r *http.Request, id string) bool {
	if !party.ValidNeteaseID(id) {
		return false
	}
	if s.musicOwner(r) != "" {
		return true
	}
	public := s.store.Public()
	raw := "/api/netease/audio/" + id
	if !public.Session.LotteryVisible && public.Question != nil {
		for _, m := range public.Question.Media {
			if m.URL == raw && m.Kind == "audio" && m.Netease != nil {
				return true
			}
		}
	}
	for _, asset := range public.Preload {
		if asset.URL == raw && asset.Kind == "audio" {
			return true
		}
	}
	return false
}
