package server

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

func validNeteaseCDN(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Port() != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.HasSuffix(host, ".music.126.net") && len(host) > len(".music.126.net")
}

var blockedMusicNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("2001:db8::/32"),
}

func publicMusicIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	for _, prefix := range blockedMusicNetworks {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

type musicConnection struct{ net.Conn }

func (c musicConnection) Read(p []byte) (int, error) {
	_ = c.Conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	return c.Conn.Read(p)
}
func musicDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, &net.DNSError{Err: "no address", Name: host}
	}
	for _, ip := range ips {
		if !publicMusicIP(ip.IP) {
			return nil, &net.AddrError{Err: "non-public music address", Addr: host}
		}
	}
	var last error
	dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	for _, ip := range ips {
		c, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if err == nil {
			return musicConnection{c}, nil
		}
		last = err
	}
	return nil, last
}
func newNeteaseHTTP() *http.Client {
	return &http.Client{
		Transport: &http.Transport{DialContext: musicDial, ResponseHeaderTimeout: 15 * time.Second, TLSHandshakeTimeout: 10 * time.Second, IdleConnTimeout: 60 * time.Second, MaxIdleConns: 16, MaxConnsPerHost: 8, DisableCompression: true},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 4 || !validNeteaseCDN(req.URL.String()) {
				return &net.AddrError{Err: "unsupported music redirect", Addr: req.URL.Hostname()}
			}
			return nil
		},
	}
}
func (s *Server) neteaseAudio(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("songId")
	if s.netease == nil || !s.musicVisible(r, id) {
		http.NotFound(w, r)
		return
	}
	for attempt := 0; attempt < 2; attempt++ {
		stream, err := s.netease.Resolve(r.Context(), id)
		if err != nil {
			musicError(w, err)
			return
		}
		if !validNeteaseCDN(stream.URL) {
			respond(w, 502, map[string]string{"error": "网易云返回了不支持的音频地址"})
			return
		}
		upstream, err := http.NewRequestWithContext(r.Context(), r.Method, stream.URL, nil)
		if err != nil {
			respond(w, 502, map[string]string{"error": "网易云音频地址无效"})
			return
		}
		upstream.Header.Set("Referer", "https://music.163.com/")
		upstream.Header.Set("Accept-Encoding", "identity")
		for _, header := range []string{"Range", "If-Range"} {
			if value := r.Header.Get(header); value != "" {
				upstream.Header.Set(header, value)
			}
		}
		response, err := s.neteaseHTTP.Do(upstream)
		if err != nil {
			if response != nil {
				response.Body.Close()
			}
			if r.Context().Err() != nil {
				return
			}
			respond(w, 502, map[string]string{"error": "无法连接网易云音频，请检查网络后重试"})
			return
		}
		if attempt == 0 && (response.StatusCode == 401 || response.StatusCode == 403 || response.StatusCode == 404 || response.StatusCode == 410) {
			response.Body.Close()
			s.netease.Invalidate(id)
			continue
		}
		defer response.Body.Close()
		if response.StatusCode != 200 && response.StatusCode != 206 && response.StatusCode != 416 {
			respond(w, 502, map[string]string{"error": "网易云音频暂不可用，请重试"})
			return
		}
		// Only media response headers cross this boundary, never CDN cookies.
		for _, header := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
			if value := response.Header.Get(header); value != "" {
				w.Header().Set(header, value)
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(response.StatusCode)
		if r.Method != "HEAD" {
			_, _ = io.CopyBuffer(w, response.Body, make([]byte, 64<<10))
		}
		return
	}
}
