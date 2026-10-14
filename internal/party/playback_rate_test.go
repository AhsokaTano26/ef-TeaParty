package party

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestVideoRateAnchorsCurrentPositionBeforeChangingSpeed(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{{ID: "video", Kind: "video", URL: "/media/video.mp4", Start: 5, End: 100}}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	// Exercise the same rate field names used by saved sessions and host commands.
	startedAt := time.Now().UnixMilli() - 2000
	raw, err := json.Marshal(map[string]any{"status": "playing", "position": 10, "updatedAt": startedAt, "index": 0, "seq": 4, "rate": 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &s.state.Session.Media); err != nil {
		t.Fatal(err)
	}
	var command Action
	if err := json.Unmarshal([]byte(`{"op":"rate","id":"q","index":0,"rate":0.5,"seq":4}`), &command); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(command); err != nil {
		t.Fatal(err)
	}
	p := s.Snapshot().Session.Media
	want := 10 + float64(p.UpdatedAt-startedAt)/1000*2
	if p.Position != want || p.Status != "playing" || p.Seq != 5 {
		t.Fatalf("changing speed jumped position or paused playback: got %+v, want position %.3f", p, want)
	}
	encoded, _ := json.Marshal(p)
	var wire map[string]any
	_ = json.Unmarshal(encoded, &wire)
	if wire["rate"] != 0.5 {
		t.Fatalf("new playback speed missing from shared state: %s", encoded)
	}
}

func videoRateStore(t *testing.T) *Store {
	t.Helper()
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Questions[0].Media = []Media{
		{ID: "video", Kind: "video", URL: "/media/video.mp4", Start: 5, End: 100},
		{ID: "second-video", Kind: "video", URL: "/media/second.mp4", Start: 7, End: 80},
		{ID: "audio", Kind: "audio", URL: "/media/audio.mp3", Start: 3, End: 60},
	}
	cfg.Questions = append(cfg.Questions, Question{ID: "next-page", Kind: "intro", Title: "Next", Enabled: true})
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestVideoRatePersistsAcrossPlaybackCommands(t *testing.T) {
	for _, op := range []string{"pause", "play", "replay", "seek", "showLottery"} {
		t.Run(op, func(t *testing.T) {
			s := videoRateStore(t)
			startedAt := time.Now().UnixMilli() - 2000
			s.state.Session.Media = Playback{Status: "playing", Position: 10, Rate: 2, UpdatedAt: startedAt, Seq: 4}
			a := Action{Op: op, ID: "q"}
			if op == "seek" {
				a.Position = 35
			}
			if err := s.Apply(a); err != nil {
				t.Fatal(err)
			}
			p := s.Snapshot().Session.Media
			wantPosition := 10 + float64(p.UpdatedAt-startedAt)/1000*2
			wantStatus := "playing"
			switch op {
			case "seek":
				wantPosition = 35
			case "replay":
				wantPosition = 5
			case "play":
				wantPosition = 10 + float64(p.UpdatedAt-300-startedAt)/1000*2
			case "pause", "showLottery":
				wantStatus = "paused"
			}
			if p.Position != wantPosition || p.Status != wantStatus || p.Rate != 2 || p.Seq != 5 {
				t.Fatalf("%s lost shared speed/position: got %+v, want position %.3f status %s", op, p, wantPosition, wantStatus)
			}
		})
	}
}

func TestVideoRateChangeKeepsPendingStartAndPausedState(t *testing.T) {
	s := videoRateStore(t)
	future := time.Now().UnixMilli() + 3000
	s.state.Session.Media = Playback{Status: "playing", Position: 20, Rate: 1.5, UpdatedAt: future, Seq: 10}
	if err := s.Apply(Action{Op: "rate", ID: "q", Rate: 2}); err != nil {
		t.Fatal(err)
	}
	p := s.Snapshot().Session.Media
	if p.Position != 20 || p.UpdatedAt != future || p.Status != "playing" || p.Rate != 2 {
		t.Fatalf("speed adjustment moved the pending shared cue: %+v", p)
	}
	if err := s.Apply(Action{Op: "pause", ID: "q"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "rate", ID: "q", Rate: 0.5}); err != nil {
		t.Fatal(err)
	}
	p = s.Snapshot().Session.Media
	if p.Position != 20 || p.Status != "paused" || p.Rate != 0.5 {
		t.Fatalf("changing paused video speed resumed or moved playback: %+v", p)
	}
}

func TestVideoRateResetsOnlyWhenSelectedMediaChanges(t *testing.T) {
	for _, a := range []Action{{Op: "pause", ID: "q", Index: 1}, {Op: "replay", ID: "q", Index: 2}, {Op: "goto", ID: "next-page"}} {
		t.Run(a.Op, func(t *testing.T) {
			s := videoRateStore(t)
			s.state.Session.Media = Playback{Status: "paused", Position: 10, Rate: 2}
			if err := s.Apply(a); err != nil {
				t.Fatal(err)
			}
			if p := s.Snapshot().Session.Media; p.Rate != 1 {
				t.Fatalf("previous video's speed leaked into another media/page: %+v", p)
			}
		})
	}
}

func TestVideoRateRejectsInvalidRatesAndStaleSelection(t *testing.T) {
	s := videoRateStore(t)
	s.state.Session.Media = Playback{Status: "paused", Position: 10, Rate: 1, Seq: 10}
	stale := int64(9)
	commands := []Action{
		{Op: "rate", ID: "old-page", Rate: 1.5},
		{Op: "rate", ID: "q", Rate: 1.5, Index: 1},
		{Op: "rate", ID: "q", Rate: 1.5, Index: -1},
		{Op: "rate", ID: "q", Rate: 1.5, Index: 99},
		{Op: "rate", ID: "q", Rate: 1.5, Seq: &stale},
	}
	for _, rate := range []float64{0, -1, 0.49, 2.01, math.NaN(), math.Inf(1), math.Inf(-1)} {
		commands = append(commands, Action{Op: "rate", ID: "q", Rate: rate})
	}
	before := s.Snapshot()
	for _, command := range commands {
		if err := s.Apply(command); err == nil {
			t.Fatalf("invalid rate action accepted: %+v", command)
		}
		if got := s.Snapshot(); got.Revision != before.Revision || got.Session != before.Session {
			t.Fatalf("rejected rate action mutated the live session: %+v", command)
		}
	}
	if err := s.Apply(Action{Op: "pause", ID: "q", Index: 2}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "rate", ID: "q", Index: 2, Rate: 1.5}); err == nil {
		t.Fatal("video speed control accepted an audio target")
	}
}

func TestVideoRateRestoresAtSnapshotAndAcceptsLegacyArchives(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		rate, wantPosition, wantRate float64
	}{{"double", 2, 16, 2}, {"half", 0.5, 11.5, 0.5}, {"legacy", 0, 13, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			s := videoRateStore(t)
			source := s.Snapshot()
			source.Session.Media = Playback{Status: "playing", Position: 10, Rate: tc.rate, UpdatedAt: 100000, Seq: 4}
			if err := s.Restore(source, 103000, source.Revision); err != nil {
				t.Fatal(err)
			}
			p := s.Snapshot().Session.Media
			if p.Position != tc.wantPosition || p.Rate != tc.wantRate || p.Status != "paused" {
				t.Fatalf("restore did not stop at the captured playback position/speed: %+v", p)
			}
		})
	}
	for _, rate := range []float64{-1, 0.49, 2.01, math.NaN(), math.Inf(1)} {
		s := videoRateStore(t)
		source := s.Snapshot()
		source.Session.Media.Rate = rate
		if err := s.Restore(source, source.ServerTime, source.Revision); err == nil {
			t.Fatalf("archive with invalid rate %v accepted", rate)
		}
	}
}

func TestVideoRateReopenPausesUsingSavedSpeed(t *testing.T) {
	for _, rate := range []float64{0, 0.5, 2} {
		s := videoRateStore(t)
		startedAt := time.Now().UnixMilli() - 2000
		s.state.Session.Media = Playback{Status: "playing", Position: 10, Rate: rate, UpdatedAt: startedAt}
		if err := s.save(s.state); err != nil {
			t.Fatal(err)
		}
		before := time.Now().UnixMilli()
		reopened, err := Open(s.path, Config{})
		if err != nil {
			t.Fatal(err)
		}
		after := time.Now().UnixMilli()
		p := reopened.Snapshot().Session.Media
		wantRate := rate
		if rate == 0 {
			wantRate = 1
		}
		low := 10 + float64(before-startedAt)/1000*wantRate
		high := 10 + float64(after-startedAt)/1000*wantRate
		if p.Position < low || p.Position > high || p.Status != "paused" || p.Rate != wantRate {
			t.Fatalf("reopened playback lost its saved speed: %+v, position range %.3f–%.3f", p, low, high)
		}
	}
	for _, rate := range []float64{-1, 0.49, 2.01} {
		s := videoRateStore(t)
		s.state.Session.Media.Rate = rate
		if err := s.save(s.state); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(s.path, Config{}); err == nil {
			t.Fatalf("saved invalid rate %v accepted", rate)
		}
	}
}
