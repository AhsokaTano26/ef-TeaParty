package party

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestWarmupAudioAppearancePersistsAndReachesProjection(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	if err := json.Unmarshal([]byte(`{"id":"q","kind":"warmup","title":"暖场","enabled":true,"warmupAudio":{"cover":"/media/cd.png","background":"/assets/ppt/music.png"}}`), &cfg.Questions[0]); err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, question := range []*Question{reopened.Snapshot().Current(), reopened.Public().Question} {
		raw, err := json.Marshal(question)
		if err != nil || !strings.Contains(string(raw), `"warmupAudio":{"cover":"/media/cd.png","background":"/assets/ppt/music.png"}`) {
			t.Fatalf("saved/projected page lost warmup appearance: %s (%v)", raw, err)
		}
	}
	// Retain appearance when the host temporarily changes the page type.
	cfg = reopened.Snapshot().Config
	cfg.Questions[0].Kind = "intro"
	if err := reopened.Configure(cfg, 0); err != nil {
		t.Fatal("changing page type rejected stored appearance", err)
	}
}

func TestWarmupAudioAppearanceRejectsUnsafeURLsWithoutReplacingPage(t *testing.T) {
	for _, appearance := range []string{
		`{"cover":"javascript:alert(1)","background":""}`,
		`{"cover":"","background":"data:image/png;base64,AAAA"}`,
		`{"cover":"/media/../private.png","background":""}`,
		`{"cover":"","background":"https://user:password@example.com/bg.png"}`,
	} {
		t.Run(appearance, func(t *testing.T) {
			s := testStore(t)
			before := s.Snapshot()
			cfg := before.Config
			if err := json.Unmarshal([]byte(`{"id":"q","kind":"warmup","title":"新暖场","enabled":true,"warmupAudio":`+appearance+`}`), &cfg.Questions[0]); err != nil {
				t.Fatal(err)
			}
			if err := s.Configure(cfg, 0); err == nil {
				t.Fatal("unsafe warmup image URL accepted")
			}
			if s.Snapshot().Config.Questions[0].Title != "test" || s.Snapshot().Revision != before.Revision {
				t.Fatal("invalid appearance replaced the saved page")
			}
		})
	}
}

func TestWarmupAudioAppearancePreloadsOnlyForWarmupPages(t *testing.T) {
	var st State
	if err := json.Unmarshal([]byte(`{"session":{"currentId":"current"},"config":{"settings":{"background":"/media/default.png"},"questions":[{"id":"current","enabled":true},{"id":"next","kind":"warmup","enabled":true,"warmupAudio":{"cover":"/media/cd.png","background":"/media/music.png"},"media":[{"kind":"audio","url":"/media/song.mp3"}]}]}}`), &st); err != nil {
		t.Fatal(err)
	}
	want := []PreloadAsset{{URL: "/media/default.png", Kind: "image"}, {URL: "/media/cd.png", Kind: "image"}, {URL: "/media/music.png", Kind: "image"}, {URL: "/media/song.mp3", Kind: "audio"}}
	if got := nextPreloadPlan(st); !reflect.DeepEqual(got, want) {
		t.Fatalf("warmup preload = %+v; want %+v", got, want)
	}
	st.Config.Questions[1].Kind = "intro"
	want = []PreloadAsset{want[0], want[3]}
	if got := nextPreloadPlan(st); !reflect.DeepEqual(got, want) {
		t.Fatalf("non-warmup page loaded hidden CD appearance: %+v", got)
	}
}

func TestLegacyQuestionOmitsWarmupAudioAppearance(t *testing.T) {
	s := testStore(t)
	raw, err := json.Marshal(s.Public().Question)
	if err != nil || strings.Contains(string(raw), "warmupAudio") {
		t.Fatalf("legacy page gained an empty appearance: %s (%v)", raw, err)
	}
}

func TestPerSongWarmupAppearancePersistsAndPublicHidesAnswerArtwork(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	if err := json.Unmarshal([]byte(`{"id":"q","kind":"warmup","title":"暖场","enabled":true,"media":[{"id":"song","kind":"audio","url":"/media/song.mp3","warmupAudio":{"cover":"/media/song-cover.png","background":"/media/song-background.png"}},{"id":"secret","kind":"audio","url":"/media/secret.mp3","answerOnly":true,"warmupAudio":{"cover":"/media/secret-cover.png","background":"/media/secret-background.png"}}]}`), &cfg.Questions[0]); err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, question := range []*Question{reopened.Snapshot().Current(), reopened.Public().Question} {
		raw, err := json.Marshal(question)
		if err != nil || !strings.Contains(string(raw), `"warmupAudio":{"cover":"/media/song-cover.png","background":"/media/song-background.png"}`) {
			t.Fatalf("saved/projected song lost appearance: %s (%v)", raw, err)
		}
	}
	raw, _ := json.Marshal(reopened.Public().Question)
	if strings.Contains(string(raw), "secret") {
		t.Fatal("answer-only song artwork leaked before reveal")
	}
	cfg = reopened.Snapshot().Config
	cfg.Questions[0].Kind = "intro"
	cfg.Questions[0].Media[0].Kind = "video"
	if err := reopened.Configure(cfg, 0); err != nil {
		t.Fatal("changing media/page type rejected stored appearance", err)
	}
}

func TestPerSongWarmupAppearanceRejectsUnsafeURLs(t *testing.T) {
	for _, appearance := range []string{
		`{"cover":"javascript:alert(1)","background":""}`,
		`{"cover":"","background":"data:image/png;base64,AAAA"}`,
	} {
		s := testStore(t)
		cfg := s.Snapshot().Config
		if err := json.Unmarshal([]byte(`{"id":"q","kind":"warmup","title":"新暖场","enabled":true,"media":[{"id":"song","kind":"audio","url":"/media/song.mp3","warmupAudio":`+appearance+`}]}`), &cfg.Questions[0]); err != nil {
			t.Fatal(err)
		}
		if err := s.Configure(cfg, 0); err == nil {
			t.Fatal("unsafe song appearance URL accepted")
		}
		if s.Snapshot().Config.Questions[0].Title != "test" {
			t.Fatal("invalid song appearance replaced saved page")
		}
	}
}

func TestWarmupPreloadsOnlySelectedSongAppearanceWithIndependentFallbacks(t *testing.T) {
	for _, tc := range []struct {
		name, page, song, cover, background string
	}{
		{"song cover and page background", `{"cover":"/media/page-cover.png","background":"/media/page-bg.png"}`, `{"cover":"/media/song-cover.png"}`, "/media/song-cover.png", "/media/page-bg.png"},
		{"page cover and song background", `{"cover":"/media/page-cover.png","background":"/media/page-bg.png"}`, `{"background":"/media/song-bg.png"}`, "/media/page-cover.png", "/media/song-bg.png"},
		{"song cover and built-in background", `null`, `{"cover":"/media/song-cover.png"}`, "/media/song-cover.png", "/assets/warmup/default-background.svg"},
		{"built-in cover and page background", `{"background":"/media/page-bg.png"}`, `{}`, "/assets/warmup/default-cd.svg", "/media/page-bg.png"},
		{"legacy page built-in appearance", `null`, `null`, "/assets/warmup/default-cd.svg", "/assets/warmup/default-background.svg"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var next Question
			if err := json.Unmarshal([]byte(`{"id":"next","kind":"warmup","enabled":true,"warmupAudio":`+tc.page+`,"media":[{"kind":"audio","url":"/media/answer.mp3","answerOnly":true,"warmupAudio":{"cover":"/media/private.png"}},{"kind":"image","url":"/media/unused.png"},{"kind":"audio","url":"/media/selected.mp3","warmupAudio":`+tc.song+`},{"kind":"audio","url":"/media/later.mp3","warmupAudio":{"cover":"/media/later-cover.png","background":"/media/later-bg.png"}}]}`), &next); err != nil {
				t.Fatal(err)
			}
			st := State{Session: Session{CurrentID: "current"}, Config: Config{Questions: []Question{{ID: "current"}, next}}}
			want := []PreloadAsset{{URL: tc.cover, Kind: "image"}, {URL: tc.background, Kind: "image"}, {URL: "/media/selected.mp3", Kind: "audio"}}
			if got := nextPreloadPlan(st); !reflect.DeepEqual(got, want) {
				t.Fatalf("selected audio appearance preload = %+v; want %+v", got, want)
			}
			st.Config.Questions[1].Media[2].Kind = "video"
			want = []PreloadAsset{{URL: "/media/selected.mp3", Kind: "video"}}
			if got := nextPreloadPlan(st); !reflect.DeepEqual(got, want) {
				t.Fatalf("video loaded audio-only artwork: %+v", got)
			}
		})
	}
}
