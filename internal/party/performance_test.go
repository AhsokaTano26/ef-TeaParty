package party

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func performanceState(pages int) State {
	st := State{FormatVersion: 2, Revision: 1, ConfigRevision: 1}
	st.Config.Settings.Title = "Performance fixture"
	for i := 0; i < 8; i++ {
		st.Config.Teams = append(st.Config.Teams, Team{ID: fmt.Sprint(i), Name: "Team"})
	}
	for i := 0; i < pages; i++ {
		st.Config.Questions = append(st.Config.Questions, Question{ID: fmt.Sprint(i), Kind: "choice", Title: "Question", Body: strings.Repeat("题目内容", 30), Options: []string{"One", "Two", "Three", "Four", "Five"}, Answer: "E", Explanation: strings.Repeat("Explanation ", 20), Enabled: true, Media: []Media{{ID: "art", Kind: "image", URL: "/media/example.png"}}})
	}
	st.Session.CurrentID = "0"
	for i := 0; i < pages*4; i++ {
		st.Scores = append(st.Scores, Score{ID: fmt.Sprint(i), TeamID: fmt.Sprint(i % 8), Delta: 10, Note: "correct"})
	}
	return st
}

var performanceSink any

func BenchmarkStateRead(b *testing.B) {
	for _, pages := range []int{72, 500} {
		st := performanceState(pages)
		for _, name := range []string{"Snapshot", "Public", "PublicJSON"} {
			b.Run(fmt.Sprintf("%s/%d", name, pages), func(b *testing.B) {
				s := &Store{state: st}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					switch name {
					case "Snapshot":
						performanceSink = s.Snapshot()
					case "Public":
						performanceSink = s.Public()
					case "PublicJSON":
						data, err := json.Marshal(s.Public())
						if err != nil {
							b.Fatal(err)
						}
						performanceSink = data
					}
				}
			})
		}
	}
}

func TestPublicReadAllocationsDoNotScaleWithHiddenBank(t *testing.T) {
	small, large := &Store{state: performanceState(72)}, &Store{state: performanceState(500)}
	a := testing.AllocsPerRun(20, func() { performanceSink = small.Public() })
	b := testing.AllocsPerRun(20, func() { performanceSink = large.Public() })
	if b > a+30 {
		t.Fatalf("public allocations scale with hidden bank: 72 pages %.0f; 500 pages %.0f", a, b)
	}
}

func TestSnapshotsOwnNestedData(t *testing.T) {
	yes := true
	st := performanceState(2)
	q := &st.Config.Questions[0]
	q.WarmupAudio = &WarmupAudioAppearance{Cover: "/media/cover.png"}
	q.WelcomeShowScores = &yes
	q.WelcomeShowTimer = &yes
	q.Media[0].WarmupAudio = &WarmupAudioAppearance{Cover: "/media/song.png"}
	q.Media[0].Netease = &NeteaseSource{SongID: "123"}
	q.Illustrations = []Illustration{{ID: "art", URL: "/media/art.png"}}
	st.Config.Lottery = LotteryConfig{Mode: "names", Names: []string{"Alice", "Bob"}}
	st.Session.LotteryVisible = true
	st.Draws = []Draw{{ID: "draw", Mode: "names", Values: []string{"Alice"}}}
	store := &Store{state: st}
	snap := store.Snapshot()
	snap.Config.Teams[0].Name = "changed"
	snap.Config.Lottery.Names[0] = "changed"
	snap.Scores[0].Delta = 999
	snap.Draws[0].Values[0] = "changed"
	mutate := func(q *Question) {
		q.Options[0] = "changed"
		q.Media[0].URL = "changed"
		q.Media[0].WarmupAudio.Cover = "changed"
		q.Media[0].Netease.SongID = "999"
		q.Illustrations[0].URL = "changed"
		q.WarmupAudio.Cover = "changed"
		*q.WelcomeShowScores = false
		*q.WelcomeShowTimer = false
	}
	mutate(&snap.Config.Questions[0])
	pub := store.Public()
	mutate(pub.Question)
	pub.Teams[0].Name = "changed"
	pub.Draw.Values[0] = "changed"
	pub.Lottery.Candidates[0] = "changed"
	pub.Lottery.LandingValues[0] = "changed"
	after := store.Snapshot()
	raw, _ := json.Marshal(after)
	if strings.Contains(string(raw), "changed") || after.Config.Questions[0].Media[0].Netease.SongID != "123" || !*after.Config.Questions[0].WelcomeShowTimer {
		t.Fatal("snapshot mutation reached store")
	}
	if store.Public().Question.Answer != "" || store.Snapshot().Config.Questions[0].Answer != "E" {
		t.Fatal("public answer filtering changed store")
	}
}

func TestConcurrentPublicSnapshotsAndActions(t *testing.T) {
	s := testStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				public := s.Public()
				public.Question.Options[0] = "local public edit"
				public.Teams[0].Name = "local public edit"
				snapshot := s.Snapshot()
				snapshot.Config.Questions[0].Options[0] = "local private edit"
			}
		}()
	}
	for i := 0; i < 20; i++ {
		if err := s.Apply(Action{Op: "adjust", TeamID: "a", Delta: 1}); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
	final := s.Snapshot()
	if final.Config.Questions[0].Options[0] != "甲" || final.TeamScore("a") != 20 {
		t.Fatal("concurrent reads corrupted activity")
	}
}
