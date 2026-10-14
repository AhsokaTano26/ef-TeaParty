package party

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOpeningAnimationMigrationPreservesHostPagesAndRunsOnce(t *testing.T) {
	st := testStore(t).Snapshot()
	st.FormatVersion = 1
	st.Config.Questions = append([]Question{{ID: "welcome", Kind: "intro", Title: "主持人修改的开场", Enabled: true}}, st.Config.Questions...)
	st.Scores = []Score{{ID: "score", TeamID: "a", Delta: 7}}
	path := filepath.Join(t.TempDir(), "state.json")
	b, _ := json.Marshal(st)
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	got := s.Snapshot()
	if len(got.Config.Questions) != 3 || got.Config.Questions[1].ID != "opening-logos" {
		t.Fatalf("logo animation was not inserted directly after welcome: %+v", got.Config.Questions)
	}
	if got.Config.Questions[0].Title != st.Config.Questions[0].Title || got.Session.CurrentID != st.Session.CurrentID || got.TeamScore("a") != 7 {
		t.Fatal("migration changed host content, live page, or scores")
	}
	if got.ConfigRevision != st.ConfigRevision+1 {
		t.Fatal("migration did not invalidate stale editors")
	}
	cfg := got.Config
	cfg.Questions = append(cfg.Questions[:1], cfg.Questions[2:]...)
	if err := s.Configure(cfg, got.ConfigRevision); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, Config{})
	if err != nil || len(s.Snapshot().Config.Questions) != 2 {
		t.Fatalf("deleted animation was reinserted: %v", err)
	}
}

func TestOpeningAnimationSharesStartAndRejectsStaleReplay(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	var page Question
	if err := json.Unmarshal([]byte(`{"id":"logos","kind":"intro","presentation":"logos","title":"热爱集结","enabled":true}`), &page); err != nil {
		t.Fatal(err)
	}
	cfg.Questions = append(cfg.Questions, page)
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "goto", ID: "logos"}); err != nil {
		t.Fatal(err)
	}
	startedAt := func() float64 {
		b, _ := json.Marshal(s.Public())
		var raw map[string]any
		_ = json.Unmarshal(b, &raw)
		return raw["session"].(map[string]any)["presentationStartedAt"].(float64)
	}
	b, _ := json.Marshal(s.Public())
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	if raw["session"].(map[string]any)["presentationStartedAt"] == nil {
		t.Fatal("shared animation clock is missing")
	}
	before := startedAt()
	if before <= 0 {
		t.Fatal("page navigation did not start the animation")
	}
	if err := s.Apply(Action{Op: "replayPresentation", ID: "logos"}); err != nil {
		t.Fatal(err)
	}
	if startedAt() <= before {
		t.Fatal("replay did not produce a new shared timeline")
	}
	if err := s.Apply(Action{Op: "goto", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "replayPresentation", ID: "logos"}); err == nil {
		t.Fatal("stale replay changed another page")
	}
}
