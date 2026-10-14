package party

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDelayedSongPlaybackUsesSharedStartTimeAndCanBeCancelled(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Kind = "song"
	cfg.Questions[0].Media = []Media{{ID: "audio", Kind: "audio", URL: "/media/song.mp3", Start: 30, End: 60}}
	second := cfg.Questions[0]
	second.ID = "next-song"
	cfg.Questions = append(cfg.Questions, second)
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "seek", ID: "q", Position: 42}); err != nil {
		t.Fatal(err)
	}
	// JSON models the new host command without requiring the field before implementation.
	var command Action
	if err := decodeDelayAction(&command); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	if err := s.Apply(command); err != nil {
		t.Fatal(err)
	}
	after := time.Now().UnixMilli()
	p := s.Public().Session.Media
	if p.UpdatedAt < before+3000 || p.UpdatedAt > after+3000 || p.Position != 42 {
		t.Fatalf("projection did not receive a shared 3-second start: %+v", p)
	}
	if err := s.Apply(Action{Op: "pause", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	p = s.Public().Session.Media
	if p.Status != "paused" || p.Position != 42 || p.UpdatedAt > time.Now().UnixMilli() {
		t.Fatalf("cancelling countdown changed the playback position: %+v", p)
	}
	if err := s.Apply(command); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path, cfg)
	if err != nil {
		t.Fatal(err)
	}
	resumed := reopened.Snapshot().Session.Media
	if resumed.Status != "paused" || resumed.Position != 42 {
		t.Fatalf("restart did not safely cancel pending playback: %+v", resumed)
	}
	old := s.Public().Session.Media.Seq
	if err := s.Apply(Action{Op: "next"}); err != nil {
		t.Fatal(err)
	}
	p = s.Public().Session.Media
	if p.Status != "paused" || p.UpdatedAt > time.Now().UnixMilli() {
		t.Fatal("pending audio countdown survived page switch")
	}
	if err := s.Apply(Action{Op: "pause", ID: "q", Seq: &old}); err == nil {
		t.Fatal("late audio callback affected the next song")
	}
}

func TestCustomQuestionTimerKeepsDurationSeparateFromMediaCue(t *testing.T) {
	s := testStore(t)
	if err := s.Apply(Action{Op: "timerReset", ID: "q", Seconds: 175}); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	if err := s.Apply(Action{Op: "timerStart", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	timer := s.Public().Session.Timer
	if timer.Remaining != 175 || timer.Deadline <= time.Now().UnixMilli()+174000 {
		t.Fatalf("custom duration was not used: %+v", timer)
	}
	if s.Snapshot().Session.Media != before.Session.Media {
		t.Fatal("starting question timer changed audio playback")
	}
	for _, seconds := range []int{-1, 86401} {
		for _, op := range []string{"timerReset", "timerStart"} {
			if err := s.Apply(Action{Op: op, ID: "q", Seconds: seconds}); err == nil {
				t.Fatalf("invalid %s duration accepted: %d", op, seconds)
			}
		}
	}
}

func decodeDelayAction(a *Action) error {
	return json.Unmarshal([]byte(`{"op":"play","id":"q","delay":3}`), a)
}
