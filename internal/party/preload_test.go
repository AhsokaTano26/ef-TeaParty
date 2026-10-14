package party

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestNextPreloadPlanPrivacyAndBounds(t *testing.T) {
	st := State{Session: Session{CurrentID: "current"}, Config: Config{
		Settings: Settings{Background: "/media/background.png"},
		Questions: []Question{
			{ID: "current", Enabled: true},
			{ID: "disabled", Media: []Media{{Kind: "image", URL: "/media/disabled.png"}}},
			{ID: "next", Enabled: true, Kind: "intro", Title: "secret title", Body: "secret body", Answer: "secret answer", Source: "secret source", Illustrations: []Illustration{{URL: "/media/art.png"}}, Media: []Media{
				{Kind: "image", URL: "/media/answer.png", AnswerOnly: true},
				{Kind: "audio", URL: "/media/answer.mp3", AnswerOnly: true},
				{Kind: "image", URL: "/media/art.png"},
				{Kind: "image", URL: "/media/image.png"},
				{Kind: "audio", URL: "/media/first.mp3"},
				{Kind: "video", URL: "/media/second.mp4"},
			}},
		},
	}}
	for i := 0; i < 100; i++ {
		st.Config.Questions[2].Media = append(st.Config.Questions[2].Media, Media{Kind: "image", URL: fmt.Sprintf("/media/%d.png", i)})
	}
	plan := nextPreloadPlan(st)
	if len(plan) != 5 {
		t.Fatalf("expected four images and one AV, got %+v", plan)
	}
	encoded, _ := json.Marshal(plan)
	for _, forbidden := range []string{"secret", "answer", "disabled", "second.mp4", `"id"`, `"name"`} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("preload leaked %s: %s", forbidden, encoded)
		}
	}
	if !strings.Contains(string(encoded), "first.mp3") {
		t.Fatal("first visible AV missing")
	}
}

func TestNextPreloadPlanSkipsHiddenPresentationMediaAndDoesNotWrap(t *testing.T) {
	for _, q := range []Question{
		{ID: "welcome", Kind: "intro"},
		{ID: "logos", Kind: "intro", Presentation: "logos"},
		{ID: "scores", Kind: "score"},
	} {
		q.Enabled = true
		q.Media = []Media{{Kind: "video", URL: "/media/hidden.mp4"}}
		st := State{Session: Session{CurrentID: "current"}, Config: Config{Questions: []Question{{ID: "current"}, q}}}
		if got := nextPreloadPlan(st); len(got) != 0 {
			t.Fatalf("hidden media for %s: %+v", q.ID, got)
		}
		st.Session.CurrentID = q.ID
		if got := nextPreloadPlan(st); len(got) != 0 {
			t.Fatal("last page must not wrap")
		}
	}
}

func TestPublicContainsOnlyMinimalNextAssets(t *testing.T) {
	s := testStore(t)
	s.mu.Lock()
	s.state.Config.Questions = append(s.state.Config.Questions, Question{ID: "next", Enabled: true, Kind: "choice", Title: "unpublished-title", Answer: "unpublished-answer", Media: []Media{{Kind: "image", URL: "/media/public.png"}, {Kind: "image", URL: "/media/private.png", AnswerOnly: true}}})
	s.mu.Unlock()
	p := s.Public()
	b, _ := json.Marshal(p)
	if len(p.Preload) != 1 || !strings.Contains(string(b), "/media/public.png") {
		t.Fatal("next image missing")
	}
	for _, v := range []string{"unpublished-title", "unpublished-answer", "/media/private.png"} {
		if strings.Contains(string(b), v) {
			t.Fatalf("public state leaked %s", v)
		}
	}
}
