package server

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ef-teaparty/internal/party"
)

func TestArchiveRestoresWarmupCDImagesWithTheirOriginalBytes(t *testing.T) {
	s, mux, cookie := archiveFixture(t)
	coverBytes := []byte("\x89PNG\r\n\x1a\nCD cover")
	backgroundBytes := []byte("\x89PNG\r\n\x1a\nMusic background")
	songCoverBytes := []byte("\x89PNG\r\n\x1a\nSong CD cover")
	songBackgroundBytes := []byte("\x89PNG\r\n\x1a\nSong background")
	for name, body := range map[string][]byte{
		filepath.Join(s.media, "cd.png"):               coverBytes,
		filepath.Join(s.assets, "ppt", "music-bg.png"): backgroundBytes,
		filepath.Join(s.media, "song-cd.png"):          songCoverBytes,
		filepath.Join(s.media, "song-bg.png"):          songBackgroundBytes,
	} {
		if err := os.WriteFile(name, body, 0600); err != nil {
			t.Fatal(err)
		}
	}
	var warmup party.Question
	if err := json.Unmarshal([]byte(`{"id":"warmup","kind":"warmup","title":"暖场","enabled":true,"warmupAudio":{"cover":"/media/cd.png","background":"/assets/ppt/music-bg.png"},"media":[{"id":"song","kind":"audio","url":"/media/secret.mp3","warmupAudio":{"cover":"/media/song-cd.png","background":"/media/song-bg.png"}},{"id":"legacy","kind":"audio","url":"/media/secret.mp3"}]}`), &warmup); err != nil {
		t.Fatal(err)
	}
	cfg := s.store.Snapshot().Config
	cfg.Questions = append(cfg.Questions, warmup)
	if err := s.store.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	download := archiveRequest(mux, cookie, "GET", "/api/admin/archive", nil, "")
	if download.Code != 200 {
		t.Fatal(download.Code, download.Body.String())
	}
	inspected := inspectArchive(t, mux, cookie, download.Body.Bytes())
	if inspected.Code != 200 {
		t.Fatal(inspected.Code, inspected.Body.String())
	}
	var result struct {
		Token    string `json:"token"`
		Revision int64  `json:"revision"`
	}
	if err := json.Unmarshal(inspected.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(result)
	restored := archiveRequest(mux, cookie, "POST", "/api/admin/archive/restore", bytes.NewReader(payload), "application/json")
	if restored.Code != 200 {
		t.Fatal(restored.Code, restored.Body.String())
	}
	raw, _ := json.Marshal(s.store.Snapshot().Config.Questions[1])
	var page struct {
		Appearance party.WarmupAudioAppearance `json:"warmupAudio"`
		Media      []struct {
			Appearance *party.WarmupAudioAppearance `json:"warmupAudio"`
		} `json:"media"`
	}
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Media) != 2 || page.Media[0].Appearance == nil || page.Media[1].Appearance != nil {
		t.Fatalf("archive lost per-song appearance or materialized inherited defaults: %s", raw)
	}
	for _, asset := range []struct {
		url  string
		body []byte
	}{{page.Appearance.Cover, coverBytes}, {page.Appearance.Background, backgroundBytes}, {page.Media[0].Appearance.Cover, songCoverBytes}, {page.Media[0].Appearance.Background, songBackgroundBytes}} {
		if !strings.HasPrefix(asset.url, "/media/restored-") {
			t.Fatalf("warmup appearance URL was not restored into a new namespace: %q", asset.url)
		}
		data, err := os.ReadFile(filepath.Join(s.media, strings.TrimPrefix(asset.url, "/media/")))
		if err != nil || !bytes.Equal(data, asset.body) {
			t.Fatalf("restored appearance bytes differ for %q: %v", asset.url, err)
		}
	}
}
