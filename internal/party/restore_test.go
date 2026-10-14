package party

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRestorePreservesStatePausesAtSnapshotAndBacksUp(t *testing.T) {
	s := testStore(t)
	source := s.Snapshot()
	source.Config.Questions[0].Media = []Media{{ID: "song", Kind: "audio", URL: "/media/song.mp3", Start: 2, End: 30}}
	source.Session.Media = Playback{Status: "playing", Position: 5, UpdatedAt: 100000, Seq: 10}
	source.Session.Timer = Timer{Remaining: 30, Deadline: 123000, Duration: 30}
	source.Scores = []Score{{ID: "score", TeamID: "a", QuestionID: "q", Delta: 7, At: 90000}}
	source.ServerTime = 103000
	source.Session.PresentationStartedAt = 90000
	before := s.Snapshot()
	changed, stop := s.Subscribe()
	defer stop()
	if err := s.Restore(source, 103000, before.Revision); err != nil {
		t.Fatal(err)
	}
	got := s.Snapshot()
	if got.TeamScore("a") != 7 || got.Session.CurrentID != "q" || got.Session.Media.Status != "paused" || got.Session.Media.Position != 8 || got.Session.Timer.Remaining != 20 || got.Session.Timer.Deadline != 0 {
		t.Fatalf("restore lost or advanced snapshot state: %+v", got)
	}
	if got.Revision <= before.Revision || got.ConfigRevision <= before.ConfigRevision || got.Session.Media.Seq <= 10 {
		t.Fatal("restore did not advance synchronization revisions")
	}
	select {
	case <-changed:
	default:
		t.Fatal("restore did not broadcast")
	}
	files, _ := filepath.Glob(filepath.Join(filepath.Dir(s.path), "pre-restore-*.json"))
	if len(files) != 1 {
		t.Fatalf("pre-restore backup missing: %v", files)
	}
	b, _ := os.ReadFile(files[0])
	if len(b) == 0 {
		t.Fatal("empty backup")
	}
	reopened, err := Open(s.path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Snapshot().TeamScore("a") != 7 {
		t.Fatal("restore did not persist")
	}
}

func TestRestoreRejectsInvalidReferencesNumbersAndStaleRevision(t *testing.T) {
	s := testStore(t)
	original := s.Snapshot()
	cases := map[string]func(*State){
		"unknown team":        func(v *State) { v.Scores = []Score{{ID: "score", TeamID: "missing", Delta: 1}} },
		"unknown question":    func(v *State) { v.Scores = []Score{{ID: "score", TeamID: "a", QuestionID: "../invalid", Delta: 1}} },
		"unknown current":     func(v *State) { v.Session.CurrentID = "missing" },
		"invalid position":    func(v *State) { v.Session.Media.Position = math.Inf(1) },
		"invalid media index": func(v *State) { v.Session.Media.Index = 99 },
		"oversized score":     func(v *State) { v.Scores = []Score{{ID: "score", TeamID: "a", Delta: 1000001}} },
		"invalid draw":        func(v *State) { v.Draws = []Draw{{ID: "draw", Mode: "names", Values: []string{"absent"}}} },
		"invalid countdown":   func(v *State) { v.Session.Timer.Remaining = -1 },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			v := clone(original)
			change(&v)
			if err := s.Restore(v, original.ServerTime, original.Revision); err == nil {
				t.Fatal("invalid restore accepted")
			}
		})
	}
	if err := s.Apply(Action{Op: "adjust", TeamID: "a", Delta: 3}); err != nil {
		t.Fatal(err)
	}
	if err := s.Restore(original, original.ServerTime, original.Revision); err == nil {
		t.Fatal("stale preview overwrote live scoring")
	}
	if s.Snapshot().TeamScore("a") != 3 {
		t.Fatal("stale restore changed live state")
	}
}

func TestRestoreSaveFailureLeavesActiveStateUntouched(t *testing.T) {
	s := testStore(t)
	before := s.Snapshot()
	next := clone(before)
	next.Config.Settings.Title = "Replacement"
	if err := os.Remove(s.path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := s.Restore(next, next.ServerTime, before.Revision); err == nil {
		t.Fatal("save failure not surfaced")
	}
	after := s.Snapshot()
	before.ServerTime = 0
	after.ServerTime = 0
	if !reflect.DeepEqual(before, after) {
		t.Fatal("save failure changed active state")
	}
}

func TestRestoreRetainsScoreHistoryForDeletedQuestion(t *testing.T) {
	s := testStore(t)
	if err := s.Apply(Action{Op: "judge", ID: "q", TeamID: "a", Correct: true}); err != nil {
		t.Fatal(err)
	}
	cfg := s.Snapshot().Config
	cfg.Questions = []Question{{ID: "replacement", Kind: "intro", Title: "New page", Enabled: true}}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	source := s.Snapshot()
	if err := s.Restore(source, source.ServerTime, source.Revision); err != nil {
		t.Fatal(err)
	}
	got := s.Snapshot()
	if got.TeamScore("a") != 3 || got.Scores[0].QuestionID != "q" || got.Scores[0].Note != "test" {
		t.Fatal("deleted-page scoring history lost")
	}
}
