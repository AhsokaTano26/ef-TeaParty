package server

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"
)

var zeroMusicTime time.Time

func writeMusicArchive(path string, raw []byte) error { return os.WriteFile(path, raw, 0600) }
func TestNeteaseCDNValidation(t *testing.T) {
	for _, tc := range []struct {
		raw   string
		valid bool
	}{
		{"https://m801.music.126.net/song.mp3", true},
		{"http://m7.music.126.net/song.mp3", true},
		{"https://music.126.net.evil.test/song.mp3", false},
		{"https://127.0.0.1/song.mp3", false},
		{"https://music.163.com/song?id=3", false},
		{"https://user:pass@m801.music.126.net/song.mp3", false},
		{"https://m801.music.126.net:444/song.mp3", false},
		{"file:///etc/passwd", false},
	} {
		if validNeteaseCDN(tc.raw) != tc.valid {
			t.Fatalf("CDN validation: %s", tc.raw)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "fc00::1", "0.0.0.0", "224.0.0.1"} {
		if publicMusicIP(net.ParseIP(ip)) {
			t.Fatalf("private/nonunicast target accepted: %s", ip)
		}
	}
	if !publicMusicIP(net.ParseIP("1.1.1.1")) {
		t.Fatal("public IP blocked")
	}
	if !musicDialIPAllowed("m801.music.126.net", net.ParseIP("198.18.0.10")) {
		t.Fatal("HTTPS CDN cannot use the local fake-IP proxy")
	}
	for _, host := range []string{"localhost", "evil.test", "music.126.net.evil.test"} {
		if musicDialIPAllowed(host, net.ParseIP("198.18.0.10")) {
			t.Fatalf("fake-IP exception escaped CDN boundary: %s", host)
		}
	}
	client := newNeteaseHTTP()
	r := &http.Request{URL: &url.URL{Scheme: "https", Host: "127.0.0.1"}}
	if err := client.CheckRedirect(r, []*http.Request{{}}); err == nil {
		t.Fatal("unsafe redirect allowed")
	}
	down := &http.Request{URL: &url.URL{Scheme: "http", Host: "m801.music.126.net"}}
	if err := client.CheckRedirect(down, []*http.Request{{}}); err == nil {
		t.Fatal("CDN redirected outside TLS protection")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := musicDial(ctx, "tcp", "localhost:80"); err == nil {
		t.Fatal("private DNS address accepted")
	}
}
