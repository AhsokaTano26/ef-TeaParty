package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"ef-teaparty/internal/netease"
	"ef-teaparty/internal/party"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Server struct {
	store              *party.Store
	password           [32]byte
	media, assets, web string
	mu                 sync.Mutex
	sessions           map[string]time.Time
	attempts           map[string][]time.Time
	netease            *netease.Service
	neteaseHTTP        *http.Client
}

type Option func(*Server)

func WithNetease(service *netease.Service) Option { return func(s *Server) { s.netease = service } }

func New(store *party.Store, password, media, assets, web string, options ...Option) http.Handler {
	s := &Server{store: store, password: sha256.Sum256([]byte(password)), media: media, assets: assets, web: web, sessions: map[string]time.Time{}, attempts: map[string][]time.Time{}}
	s.neteaseHTTP = newNeteaseHTTP()
	for _, option := range options {
		option(s)
	}
	mux := http.NewServeMux()
	s.registerNeteaseRoutes(mux)
	s.registerProjectionRoutes(mux)
	s.registerArchiveRoutes(mux)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/time", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]int64{"serverTime": time.Now().UnixMilli()})
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.store.Public()) })
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) { s.events(w, r, false) })
	mux.Handle("GET /api/admin/state", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { respond(w, 200, s.store.Snapshot()) })))
	mux.Handle("GET /api/admin/events", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.events(w, r, true) })))
	mux.Handle("POST /api/admin/action", s.auth(http.HandlerFunc(s.action)))
	mux.Handle("PUT /api/admin/config", s.auth(http.HandlerFunc(s.config)))
	mux.Handle("POST /api/admin/upload", s.auth(http.HandlerFunc(s.upload)))
	mux.Handle("GET /media/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/media/", http.FileServer(http.Dir(media))).ServeHTTP(w, r)
	}))
	mux.Handle("GET /assets/ppt/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The seed contains the entire answer bank and is never public.
		if !strings.HasPrefix(r.URL.Path, "/assets/ppt/") || strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/assets/", http.FileServer(http.Dir(assets))).ServeHTTP(w, r)
	}))
	webFiles := staticFiles(web)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/" && r.URL.Path != "/stage" {
			webFiles.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(web, "index.html"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; media-src 'self' https: http: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			if origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					respond(w, 403, map[string]string{"error": "禁止跨站修改"})
					return
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func respond(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return fmt.Errorf("JSON 数据无效：%w", e)
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return fmt.Errorf("只能提交一个 JSON 对象")
	}
	return nil
}
func (s *Server) auth(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := r.Cookie("party_session")
		s.mu.Lock()
		valid := e == nil && s.sessions[c.Value].After(time.Now())
		s.mu.Unlock()
		if !valid {
			respond(w, 401, map[string]string{"error": "请先登录后台"})
			return
		}
		h.ServeHTTP(w, r)
	})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Password string `json:"password"`
	}
	if e := decode(w, r, &v); e != nil {
		respond(w, 400, map[string]string{"error": e.Error()})
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := time.Now()
	s.mu.Lock()
	recent := []time.Time{}
	for _, v := range s.attempts[ip] {
		if now.Sub(v) < time.Minute {
			recent = append(recent, v)
		}
	}
	if len(recent) >= 10 {
		s.mu.Unlock()
		respond(w, 429, map[string]string{"error": "登录尝试过多，请一分钟后重试"})
		return
	}
	s.attempts[ip] = append(recent, now)
	s.mu.Unlock()
	p := sha256.Sum256([]byte(v.Password))
	if subtle.ConstantTimeCompare(p[:], s.password[:]) != 1 {
		respond(w, 401, map[string]string{"error": "后台密码不正确"})
		return
	}
	token := party.NewID() + party.NewID()
	s.mu.Lock()
	for k, v := range s.sessions {
		if v.Before(now) {
			delete(s.sessions, k)
		}
	}
	s.sessions[token] = now.Add(24 * time.Hour)
	delete(s.attempts, ip)
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "party_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil, MaxAge: 86400})
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("party_session"); e == nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
		if s.netease != nil {
			s.netease.CancelOwner(c.Value)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "party_session", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Config   party.Config `json:"config"`
		Revision int64        `json:"revision"`
	}
	if e := decode(w, r, &v); e != nil {
		respond(w, 400, map[string]string{"error": e.Error()})
		return
	}
	if e := s.store.Configure(v.Config, v.Revision); e != nil {
		respond(w, 409, map[string]string{"error": e.Error()})
		return
	}
	respond(w, 200, s.store.Snapshot())
}
func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	var a party.Action
	if e := decode(w, r, &a); e != nil {
		respond(w, 400, map[string]string{"error": e.Error()})
		return
	}
	if e := s.store.Apply(a); e != nil {
		respond(w, 400, map[string]string{"error": e.Error()})
		return
	}
	respond(w, 200, s.store.Snapshot())
}
func (s *Server) events(w http.ResponseWriter, r *http.Request, admin bool) {
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE unsupported", 500)
		return
	}
	ch, stop := s.store.Subscribe()
	defer stop()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-cache")
	send := func() bool {
		var v any
		if admin {
			v = s.store.Snapshot()
		} else {
			v = s.store.Public()
		}
		b, e := json.Marshal(v)
		if e != nil {
			return false
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, e = fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
			return false
		}
		f.Flush()
		return true
	}
	if !send() {
		return
	}
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			if !send() {
				return
			}
		case <-heartbeat.C:
			if admin {
				c, e := r.Cookie("party_session")
				s.mu.Lock()
				valid := e == nil && s.sessions[c.Value].After(time.Now())
				s.mu.Unlock()
				if !valid {
					return
				}
			}
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Second))
			if _, e := io.WriteString(w, ": keepalive\n\n"); e != nil {
				return
			}
			f.Flush()
		}
	}
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	const videoLimit int64 = 3 << 30
	const mediaLimit int64 = 256 << 20
	const requestLimit int64 = videoLimit + 1<<20 // Multipart headers are outside the file limit.
	if r.ContentLength > requestLimit {
		respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "视频最大 3 GB；图片和音频最大 256 MB"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, requestLimit)
	form, e := r.MultipartReader()
	if e != nil {
		respond(w, 400, map[string]string{"error": "上传表单无效"})
		return
	}
	f, e := form.NextPart()
	if e != nil || f.FormName() != "file" || f.FileName() == "" {
		respond(w, 400, map[string]string{"error": "请选择文件"})
		return
	}
	ext := strings.ToLower(filepath.Ext(f.FileName()))
	kind := ""
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		kind = "image"
	case ".mp3", ".wav", ".m4a", ".ogg", ".flac":
		kind = "audio"
	case ".mp4", ".webm", ".mov":
		kind = "video"
	default:
		respond(w, 400, map[string]string{"error": "支持 PNG/JPG/WebP/GIF、MP3/WAV/M4A/OGG/FLAC、MP4/WebM/MOV"})
		return
	}
	head := make([]byte, 512)
	limit, limitError := mediaLimit, "图片和音频最大 256 MB"
	if kind == "video" {
		limit, limitError = videoLimit, "视频最大 3 GB"
	}
	n, e := io.ReadFull(f, head)
	if e != nil && e != io.EOF && e != io.ErrUnexpectedEOF {
		respond(w, 400, map[string]string{"error": "无法读取文件"})
		return
	}
	detected := http.DetectContentType(head[:n])
	if strings.HasPrefix(detected, "text/") || strings.Contains(detected, "xml") {
		respond(w, 400, map[string]string{"error": "文件内容不是受支持的媒体"})
		return
	}
	if e = os.MkdirAll(s.media, 0700); e != nil {
		respond(w, 500, map[string]string{"error": "无法创建素材目录"})
		return
	}
	id := party.NewID()
	name := id + ext
	path := filepath.Join(s.media, name)
	out, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		respond(w, 500, map[string]string{"error": "无法保存素材"})
		return
	}
	_, e = out.Write(head[:n])
	var copied int64
	if e == nil {
		// Read one extra byte to detect an oversized file without buffering it.
		copied, e = io.Copy(out, io.LimitReader(f, limit-int64(n)+1))
	}
	ce := out.Close()
	var tooLarge *http.MaxBytesError
	if int64(n)+copied > limit || errors.As(e, &tooLarge) {
		_ = os.Remove(path)
		respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": limitError})
		return
	}
	if e == nil {
		e = ce
	}
	if e != nil {
		_ = os.Remove(path)
		respond(w, 500, map[string]string{"error": "保存素材失败"})
		return
	}
	respond(w, 200, party.Media{ID: id, Kind: kind, URL: "/media/" + name})
}
