package party

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWarmupSwitchesVideosWithoutChangingPageAndCannotBeJudged(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Kind = "warmup"
	cfg.Questions[0].Media = []Media{
		{ID: "v1", Kind: "video", URL: "/media/one.mp4", Start: 3, End: 12},
		{ID: "v2", Kind: "video", URL: "/media/two.mp4", Start: 7, End: 20},
	}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "play", ID: "q", Index: 0}); err != nil {
		t.Fatal(err)
	}
	old := s.Snapshot().Session.Media.Seq
	if err := s.Apply(Action{Op: "replay", ID: "q", Index: 1}); err != nil {
		t.Fatal(err)
	}
	p := s.Public()
	if p.Session.CurrentID != "q" || p.Session.Media.Index != 1 || p.Session.Media.Position != 7 || p.Session.Media.Status != "playing" {
		t.Fatalf("warmup switch did not start the second video on the same page: %+v", p.Session)
	}
	if err := s.Apply(Action{Op: "pause", ID: "q", Index: 0, Seq: &old, Position: 12}); err == nil {
		t.Fatal("old video's end callback interrupted the selected video")
	}
	if err := s.Apply(Action{Op: "judge", ID: "q", TeamID: "a", Correct: true}); err == nil {
		t.Fatal("warmup was scored as a question")
	}
	if len(s.Snapshot().Scores) != 0 {
		t.Fatal("warmup changed scores")
	}
}

func TestLegacyWelcomeGetsWarmupOnceWithoutLosingActivityState(t *testing.T) {
	legacy := testStore(t).Snapshot()
	legacy.Config.Questions = append([]Question{{ID: "welcome", Kind: "intro", Title: "开场", Enabled: true}}, legacy.Config.Questions...)
	legacy.Scores = []Score{{ID: "score", TeamID: "a", Delta: 7}}
	legacy.Draws = []Draw{{ID: "draw", Mode: "names", Values: []string{"小灯"}}}
	legacy.Revision = 12
	legacy.ConfigRevision = 5
	path := filepath.Join(t.TempDir(), "state.json")
	b, _ := json.Marshal(legacy)
	// Model the old on-disk format even after the model gains a version field.
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	delete(raw, "formatVersion")
	b, _ = json.Marshal(raw)
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.Config.Questions[0].Kind != "warmup" || st.Config.Questions[1].ID != "welcome" {
		t.Fatal("warmup was not inserted before the opening page")
	}
	if st.Session.CurrentID != legacy.Session.CurrentID || st.TeamScore("a") != 7 || len(st.Draws) != 1 || st.Draws[0].Values[0] != "小灯" {
		t.Fatal("migration changed the current page, scores, or draws")
	}
	if st.Revision != 13 || st.ConfigRevision != 6 {
		t.Fatal("migration did not invalidate old configuration revisions")
	}
	s, err = Open(path, Config{})
	if err != nil || len(s.Snapshot().Config.Questions) != 4 {
		t.Fatalf("migration ran twice: %v", err)
	}
	// A host may remove the default page; reopening must respect that choice.
	cfg := s.Snapshot().Config
	cfg.Questions = cfg.Questions[1:]
	if err := s.Configure(cfg, s.Snapshot().ConfigRevision); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, Config{})
	if err != nil || len(s.Snapshot().Config.Questions) != 3 {
		t.Fatalf("deleted warmup page was reintroduced: %v", err)
	}
}

func TestMediaNamesSurviveConfigurationRoundTrip(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	if err := json.Unmarshal([]byte(`[{"id":"video","name":"开场演出","kind":"video","url":"/media/show.mp4","start":0,"end":0,"answerOnly":false}]`), &cfg.Questions[0].Media); err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(s.Public().Question.Media)
	if !strings.Contains(string(b), "开场演出") {
		t.Fatal("configured video name was lost")
	}
}
