package party

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestLotteryLandingAndCandidatesStayStableThroughReveal(t *testing.T) {
	for _, mode := range []string{"names", "numbers"} {
		t.Run(mode, func(t *testing.T) {
			st := State{
				Config:  Config{Lottery: LotteryConfig{Mode: mode, Names: []string{"1", "2", "3"}, Min: 1, Max: 3, Count: 1, NoRepeat: true}},
				Session: Session{LotteryVisible: true},
				Draws: []Draw{
					{ID: "prior", Mode: mode, Values: []string{"1"}, At: 100, RevealAt: 200},
					{ID: "current", Mode: mode, Values: []string{"3"}, At: 1000, RevealAt: 9000},
				},
			}
			rolling := lotteryPresentation(st, 5000)
			result := lotteryPresentation(st, 9000)
			if rolling.Phase != "rolling" || result.Phase != "result" {
				t.Fatal("presentation phase did not follow reveal time")
			}
			for _, v := range []*LotteryView{rolling, result} {
				fields := lotteryFields(t, PublicState{Lottery: v})
				if !reflect.DeepEqual(fields["landingValues"], []any{"3"}) {
					t.Fatalf("animation endpoint must match the current result: %v", fields["landingValues"])
				}
				if !reflect.DeepEqual(v.Used, []string{"1"}) || !reflect.DeepEqual(v.Candidates, []string{"2", "3"}) {
					t.Fatalf("reveal changed this round's track: used=%v candidates=%v", v.Used, v.Candidates)
				}
			}
			st.Draws[1].Values[0] = "2"
			if values := lotteryFields(t, PublicState{Lottery: rolling})["landingValues"]; !reflect.DeepEqual(values, []any{"3"}) {
				t.Fatalf("presentation endpoint aliases the stored draw: %v", values)
			}
			st.Session.LotteryIntro = true
			intro := lotteryPresentation(st, 5000)
			if _, exists := lotteryFields(t, PublicState{Lottery: intro})["landingValues"]; exists {
				t.Fatal("intro retained a previous draw's endpoint")
			}
			if intro.DrawID != "" || !reflect.DeepEqual(intro.Used, []string{"1", "2"}) {
				t.Fatalf("intro must prepare the next round's pool: %+v", intro)
			}
		})
	}
}

func lotteryFields(t *testing.T, p PublicState) map[string]any {
	t.Helper()
	b, _ := json.Marshal(p)
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	view, ok := v["lottery"].(map[string]any)
	if !ok {
		t.Fatal("projection has no lottery presentation state")
	}
	return view
}

func TestLotteryIntroRollingAndResultAreSeparateProjectionStates(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Lottery = LotteryConfig{Mode: "names", Names: []string{"小灯", "小祥", "小爱"}, Count: 1, NoRepeat: true}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "showLottery"}); err != nil {
		t.Fatal(err)
	}
	if lotteryFields(t, s.Public())["phase"] != "intro" || s.Public().Draw != nil {
		t.Fatal("intro showed a past winner")
	}
	if err := s.Apply(Action{Op: "draw"}); err != nil {
		t.Fatal(err)
	}
	view := lotteryFields(t, s.Public())
	if view["phase"] != "rolling" || s.Public().Draw != nil {
		t.Fatal("official result was revealed before rolling stopped")
	}
	storedDraw := s.Snapshot().Draws[0]
	if !reflect.DeepEqual(view["landingValues"], []any{storedDraw.Values[0]}) {
		t.Fatal("projection reel endpoint does not match the stored draw")
	}
	duration := view["revealAt"].(float64) - view["startedAt"].(float64)
	if duration < 5000 || duration > 10000 {
		t.Fatalf("rolling duration outside 5–10 seconds: %v", duration)
	}
	if err := s.Apply(Action{Op: "draw"}); err == nil {
		t.Fatal("double click created a second active draw")
	}
	completeDrawForTest(s)
	if lotteryFields(t, s.Public())["phase"] != "result" || len(s.Public().Draw.Values) != 1 {
		t.Fatal("stopped draw did not show its result")
	}
	first := s.Public().Draw.Values[0]
	if err := s.Apply(Action{Op: "draw"}); err != nil {
		t.Fatal(err)
	}
	completeDrawForTest(s)
	if s.Public().Draw.Values[0] == first {
		t.Fatal("no-repeat lottery selected the previous winner")
	}
	if err := s.Apply(Action{Op: "hideDraw"}); err != nil {
		t.Fatal(err)
	}
	if s.Public().Draw != nil || s.Public().Session.LotteryVisible {
		t.Fatal("lottery did not return to activity page")
	}
}

func completeDrawForTest(s *Store) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Simulate time passing without sleeping through an animation in unit tests.
	b, _ := json.Marshal(s.state)
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	items := raw["draws"].([]any)
	items[len(items)-1].(map[string]any)["revealAt"] = time.Now().UnixMilli() - 1
	b, _ = json.Marshal(raw)
	_ = json.Unmarshal(b, &s.state)
}

func TestDrawRevealBroadcastsFinalResultAtDeadline(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	cfg.Lottery = LotteryConfig{Mode: "numbers", Min: 1, Max: 10, Count: 1}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Action{Op: "draw"}); err != nil {
		t.Fatal(err)
	}
	ch, unsubscribe := s.Subscribe()
	defer unsubscribe()
	deadline := time.Now().UnixMilli() + 30
	s.mu.Lock()
	s.state.Draws[len(s.state.Draws)-1].RevealAt = deadline
	id := s.state.Draws[len(s.state.Draws)-1].ID
	s.mu.Unlock()
	s.scheduleDrawReveal(id, deadline)
	select {
	case <-ch:
		if s.Public().Draw == nil {
			t.Fatal("reveal notification arrived before result was available")
		}
	case <-time.After(time.Second):
		t.Fatal("projection never received final result notification")
	}
}
