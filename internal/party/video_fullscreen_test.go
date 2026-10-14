package party

import (
	"encoding/json"
	"reflect"
	"testing"
)

func fullscreenFlag(t *testing.T, p PublicState) bool {
	t.Helper()
	b, err := json.Marshal(p.Session)
	if err != nil {
		t.Fatal(err)
	}
	var session map[string]any
	if err := json.Unmarshal(b, &session); err != nil {
		t.Fatal(err)
	}
	return session["videoFullscreen"] == true
}

func TestHostVideoFullscreenPreservesPlaybackAndPublishesToProjection(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{
		{ID: "v1", Kind: "video", URL: "/media/one.mp4", Start: 3, End: 50},
		{ID: "v2", Kind: "video", URL: "/media/two.mp4", Start: 7, End: 50},
		{ID: "a1", Kind: "audio", URL: "/media/song.mp3", End: 20},
	}
	cfg.Questions = append(cfg.Questions, Question{ID: "next", Kind: "intro", Title: "活动说明", Enabled: true})
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "play", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	var enter Action
	if err := json.Unmarshal([]byte(`{"op":"videoFullscreen","id":"q","enabled":true}`), &enter); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(enter); err != nil {
		t.Fatal(err)
	}
	if !fullscreenFlag(t, s.Public()) {
		t.Fatal("projection did not receive host fullscreen state")
	}
	if !reflect.DeepEqual(before.Session.Media, s.Snapshot().Session.Media) {
		t.Fatal("entering fullscreen interrupted or restarted playback")
	}
	if err := s.Apply(Action{Op: "replay", ID: "q", Index: 1}); err != nil {
		t.Fatal(err)
	}
	if !fullscreenFlag(t, s.Public()) {
		t.Fatal("switching videos exited fullscreen")
	}
	if err := s.Apply(Action{Op: "pause", ID: "q", Index: 1, Position: 10}); err != nil {
		t.Fatal(err)
	}
	before = s.Snapshot()
	if err := s.Apply(Action{Op: "videoFullscreen", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if fullscreenFlag(t, s.Public()) || !reflect.DeepEqual(before.Session.Media, s.Snapshot().Session.Media) {
		t.Fatal("leaving fullscreen changed paused playback")
	}
	if err := s.Apply(enter); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "play", ID: "q", Index: 2}); err != nil {
		t.Fatal(err)
	}
	if fullscreenFlag(t, s.Public()) {
		t.Fatal("switching to audio left projection in video fullscreen")
	}
	if err := s.Apply(enter); err == nil {
		t.Fatal("audio entered video fullscreen")
	}
	if err := s.Apply(Action{Op: "play", ID: "q", Index: 0}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(enter); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "next"}); err != nil {
		t.Fatal(err)
	}
	if fullscreenFlag(t, s.Public()) {
		t.Fatal("changing pages did not restore activity layout")
	}
	if err := s.Apply(enter); err == nil {
		t.Fatal("stale page command changed the new page layout")
	}
}
