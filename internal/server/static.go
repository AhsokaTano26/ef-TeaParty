package server

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Only content-addressed build outputs may be cached across deployments.
var hashedAsset = regexp.MustCompile(`^/assets/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(js|css|png|jpg|jpeg|svg|webp|woff|woff2|wav|mp3|mp4|m4a|ogg|webm)$`)

func acceptsGzip(header string) bool {
	wildcard := false
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(part, ";")
		coding := strings.ToLower(strings.TrimSpace(fields[0]))
		if coding != "gzip" && coding != "*" {
			continue
		}
		q := 1.0
		for _, parameter := range fields[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && strings.EqualFold(key, "q") {
				parsed, err := strconv.ParseFloat(value, 64)
				if err != nil || !(parsed >= 0 && parsed <= 1) {
					q = 0
				} else {
					q = parsed
				}
			}
		}
		if coding == "gzip" {
			return q > 0
		}
		wildcard = q > 0
	}
	return wildcard
}

func staticFiles(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hashedAsset.MatchString(r.URL.Path) {
			files.ServeHTTP(w, r)
			return
		}
		filename := filepath.Join(root, strings.TrimPrefix(r.URL.Path, "/"))
		info, err := os.Stat(filename)
		if err != nil || !info.Mode().IsRegular() {
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Add("Vary", "Accept-Encoding")
		// A byte range always describes the original representation.
		if r.Header.Get("Range") == "" && acceptsGzip(r.Header.Get("Accept-Encoding")) {
			if f, err := os.Open(filename + ".gz"); err == nil {
				defer f.Close()
				if compressed, err := f.Stat(); err == nil && compressed.Mode().IsRegular() {
					w.Header().Set("Content-Encoding", "gzip")
					w.Header().Set("Content-Length", strconv.FormatInt(compressed.Size(), 10))
					w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(filename)))
					http.ServeContent(w, r, info.Name(), info.ModTime(), f)
					return
				}
			}
		}
		files.ServeHTTP(w, r)
	})
}
