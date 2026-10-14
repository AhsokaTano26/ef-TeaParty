package party

import (
	"testing"
	"time"
)

func TestVideoCueAllowsBothDisplaysToReceiveCommandBeforeSharedStart(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{{ID: "video", Kind: "video", URL: "/media/video.mp4", Start: 12, End: 30}}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	before := time.Now().UnixMilli()
	if err := s.Apply(Action{Op: "play", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	after := time.Now().UnixMilli()
	media := s.Public().Session.Media
	if media.UpdatedAt < before+250 || media.UpdatedAt > after+500 {
		t.Fatalf("video starts before both screens receive the cue: %+v", media)
	}
	if err := s.Apply(Action{Op: "pause", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if s.Snapshot().Session.Media.Position != 12 {
		t.Fatal("cancelling the prepared video changed its position")
	}
}
