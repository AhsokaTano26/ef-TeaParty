package party

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "state.json"), Config{Settings: Settings{Title: "冬日茶话会"}, Teams: []Team{{ID: "a", Name: "A组", Color: "#ce7180"}}, Questions: []Question{{ID: "q", Kind: "choice", Section: "单选答题", Title: "test", Options: []string{"甲", "乙"}, Answer: "B", Explanation: "保密解析", Points: 3, WrongPoints: -1, Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func TestVerdictReplacesAndUndoRestores(t *testing.T) {
	s := testStore(t)
	for _, a := range []Action{{Op: "judge", ID: "q", TeamID: "a", Correct: true}, {Op: "judge", ID: "q", TeamID: "a", Correct: true}, {Op: "judge", ID: "q", TeamID: "a", Correct: false}} {
		if err := s.Apply(a); err != nil {
			t.Fatal(err)
		}
	}
	st := s.Snapshot()
	if len(st.Scores) != 1 || st.TeamScore("a") != -1 {
		t.Fatalf("duplicate verdict: %+v", st.Scores)
	}
	if err := s.Apply(Action{Op: "undo", ID: st.Scores[0].ID}); err != nil {
		t.Fatal(err)
	}
	if s.Snapshot().TeamScore("a") != 0 {
		t.Fatal("undo did not restore score")
	}
}
func TestPersistenceAndPublicAnswerIsolation(t *testing.T) {
	s := testStore(t)
	if err := s.Apply(Action{Op: "adjust", TeamID: "a", Delta: 7, Player: "阿澄", Note: "手动"}); err != nil {
		t.Fatal(err)
	}
	bytes, _ := json.Marshal(s.Public())
	if strings.Contains(string(bytes), "保密解析") || strings.Contains(string(bytes), `"answer":"B"`) {
		t.Fatal("public answer leak")
	}
	reopened, err := Open(s.path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Snapshot().TeamScore("a") != 7 {
		t.Fatal("lost score")
	}
	if err := s.Apply(Action{Op: "reveal", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	bytes, _ = json.Marshal(s.Public())
	if !strings.Contains(string(bytes), "保密解析") {
		t.Fatal("revealed answer absent")
	}
}
func TestLotteryWithoutReplacementAndExhaustion(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Lottery = LotteryConfig{Mode: "numbers", Min: -2, Max: 2, Count: 2, NoRepeat: true}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.Apply(Action{Op: "draw"}); err != nil {
			t.Fatal(err)
		}
		completeDrawForTest(s)
	}
	st := s.Snapshot()
	seen := map[string]bool{}
	for _, d := range st.Draws {
		for _, v := range d.Values {
			if seen[v] {
				t.Fatal("repeat")
			}
			seen[v] = true
		}
	}
	if err := s.Apply(Action{Op: "draw"}); err == nil {
		t.Fatal("must reject exhausted pool")
	}
	if len(s.Snapshot().Draws) != 2 {
		t.Fatal("failed draw modified history")
	}
}
func TestBadConfigIsAtomicAndProtected(t *testing.T) {
	s := testStore(t)
	original, _ := os.ReadFile(s.path)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Points = 1000001
	if err := s.Configure(cfg, 0); err == nil {
		t.Fatal("invalid config accepted")
	}
	after, _ := os.ReadFile(s.path)
	if string(original) != string(after) {
		t.Fatal("invalid import mutated disk")
	}
	if err := s.Apply(Action{Op: "adjust", TeamID: "missing", Delta: 4}); err == nil {
		t.Fatal("unknown team accepted")
	}
	if err := s.Apply(Action{Op: "adjust", TeamID: "a", Delta: 4}); err != nil {
		t.Fatal(err)
	}
	cfg = s.Snapshot().Config
	cfg.Teams = nil
	if err := s.Configure(cfg, 0); err == nil {
		t.Fatal("deleted team with ledger")
	}
}
func TestNavigationSkipsDisabledAndResetsPlayback(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions = append(cfg.Questions, Question{ID: "skip", Kind: "intro", Title: "hidden", Enabled: false}, Question{ID: "end", Kind: "score", Title: "颁奖", Enabled: true})
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "next"}); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.Session.CurrentID != "end" || st.Session.Revealed || st.Session.Media.Status != "paused" {
		t.Fatal("navigation invalid")
	}
	if err := s.Apply(Action{Op: "next"}); err == nil {
		t.Fatal("end must be reported")
	}
}

func TestIndividualAndTeamPointsAreIndependent(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Points = 7
	cfg.Questions[0].PlayerPoints = 1
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "judge", ID: "q", TeamID: "a", Correct: true, Player: "小灯"}); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.TeamScore("a") != 7 || st.Scores[0].PlayerDelta != 1 {
		t.Fatalf("scores mixed: %+v", st.Scores)
	}
	if err := s.Apply(Action{Op: "judge", ID: "q", TeamID: "a", Correct: false, Player: "小灯"}); err != nil {
		t.Fatal(err)
	}
	st = s.Snapshot()
	if len(st.Scores) != 1 || st.Scores[0].PlayerDelta != 0 {
		t.Fatal("rejudging did not replace individual result")
	}
	if err := s.Apply(Action{Op: "adjust", TeamID: "a", Player: "小祥", PlayerDelta: 1, Note: "画猜个人奖励"}); err != nil {
		t.Fatal(err)
	}
	st = s.Snapshot()
	if st.TeamScore("a") != -1 || st.Scores[1].PlayerDelta != 1 {
		t.Fatal("individual adjustment changed team score")
	}
	if err := s.Apply(Action{Op: "adjust", TeamID: "a", PlayerDelta: 1}); err == nil {
		t.Fatal("individual score requires a nickname")
	}
	if err := s.Apply(Action{Op: "undo", ID: st.Scores[1].ID}); err != nil {
		t.Fatal(err)
	}
	if len(s.Snapshot().Scores) != 1 {
		t.Fatal("undo did not remove individual score")
	}
}

func TestRevealPreservesMediaIdentityAndHidingStopsAnswerMedia(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{{ID: "answer", Kind: "audio", URL: "/media/answer.mp3", AnswerOnly: true, Start: 10, End: 20}, {ID: "normal", Kind: "audio", URL: "/media/question.mp3", Start: 2, End: 8}}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "play", ID: "q", Index: 0}); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot().Session.Media
	if err := s.Apply(Action{Op: "reveal", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	p := s.Snapshot().Session.Media
	if p.Index != 1 || p.Status != "playing" || p.Position != before.Position || p.UpdatedAt != before.UpdatedAt || p.Seq <= before.Seq {
		t.Fatalf("revealing switched the playing media: %+v", p)
	}
	if err := s.Apply(Action{Op: "reveal", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if s.Snapshot().Session.Media.Index != 0 || s.Snapshot().Session.Media.Status != "playing" {
		t.Fatal("hiding lost normal audio")
	}
	if err := s.Apply(Action{Op: "reveal", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "play", ID: "q", Index: 0}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "reveal", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	p = s.Snapshot().Session.Media
	if p.Index != 0 || p.Status != "paused" || p.Position != 2 {
		t.Fatalf("answer audio continued after hiding: %+v", p)
	}
}

func TestSparseImportedConfigNormalizesArraysAndRejectsStaleRevision(t *testing.T) {
	s := testStore(t)
	var cfg Config
	if err := json.Unmarshal([]byte(`{"settings":{"title":"新活动"},"teams":null,"questions":[{"id":"intro","kind":"intro","title":"欢迎","enabled":true}]}`), &cfg); err != nil {
		t.Fatal(err)
	}
	revision := s.Snapshot().ConfigRevision
	if err := s.Configure(cfg, revision); err != nil {
		t.Fatal(err)
	}
	st := s.Snapshot()
	if st.Config.Teams == nil || st.Config.Questions[0].Options == nil || st.Config.Questions[0].Media == nil || st.Config.Lottery.Names == nil {
		t.Fatal("nullable config arrays will crash the editor")
	}
	cfg.Settings.Title = "旧草稿"
	if err := s.Configure(cfg, revision); err == nil {
		t.Fatal("stale draft accepted")
	}
	if s.Snapshot().Config.Settings.Title != "新活动" {
		t.Fatal("stale draft overwrote the config")
	}
}

func TestStaleQuestionActionsAndLateMediaStopsAreRejected(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{{ID: "audio", Kind: "audio", URL: "/media/test.mp3", End: 8}}
	second := cfg.Questions[0]
	second.ID = "q2"
	cfg.Questions = append(cfg.Questions, second)
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "next"}); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"judge", "reveal", "timerStart", "pause"} {
		if err := s.Apply(Action{Op: op, ID: "q", TeamID: "a", Correct: true}); err == nil {
			t.Fatalf("stale %s action applied to the new question", op)
		}
	}
	if len(s.Snapshot().Scores) != 0 || s.Snapshot().Session.Revealed {
		t.Fatal("stale question action changed the state")
	}
	if err := s.Apply(Action{Op: "play", ID: "q2"}); err != nil {
		t.Fatal(err)
	}
	oldSeq := s.Snapshot().Session.Media.Seq
	if err := s.Apply(Action{Op: "replay", ID: "q2"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "pause", ID: "q2", Seq: &oldSeq, Position: 8}); err == nil {
		t.Fatal("late clip-end callback stopped a new replay")
	}
	if s.Snapshot().Session.Media.Status != "playing" {
		t.Fatal("late callback mutated playback")
	}
	seq := s.Snapshot().Session.Media.Seq
	if err := s.Apply(Action{Op: "pause", ID: "q2", Seq: &seq, Position: 8}); err != nil {
		t.Fatal(err)
	}
}
