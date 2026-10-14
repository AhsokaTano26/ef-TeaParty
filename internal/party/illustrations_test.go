package party

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpeningIllustrationsPersistAndReachProjection(t *testing.T) {
	s := testStore(t)
	cfg := s.Snapshot().Config
	if err := json.Unmarshal([]byte(`{"id":"q","kind":"intro","title":"开场","enabled":true,"illustrations":[{"id":"character","url":"/media/character.png","name":"冬日立绘","x":82.5,"y":94,"width":24,"layer":"behind","flipped":true}]}`), &cfg.Questions[0]); err != nil {
		t.Fatal(err)
	}
	if err := s.Configure(cfg, 0); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path, Config{})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(reopened.Public().Question)
	for _, value := range []string{`"illustrations"`, `"x":82.5`, `"width":24`, `"flipped":true`} {
		if !strings.Contains(string(b), value) {
			t.Fatalf("projection lost illustration layout: %s", b)
		}
	}
}

func TestInvalidIllustrationLayoutCannotReplaceSavedQuestion(t *testing.T) {
	s := testStore(t)
	for _, properties := range []string{
		`"url":"javascript:alert(1)","x":50,"y":94,"width":24,"layer":"behind"`,
		`"url":"/media/character.png","x":-1,"y":94,"width":24,"layer":"behind"`,
		`"url":"/media/character.png","x":50,"y":101,"width":24,"layer":"behind"`,
		`"url":"/media/character.png","x":50,"y":94,"width":0,"layer":"behind"`,
		`"url":"/media/character.png","x":50,"y":94,"width":24,"layer":"unknown"`,
	} {
		cfg := s.Snapshot().Config
		if err := json.Unmarshal([]byte(`{"id":"q","kind":"intro","title":"新开场","enabled":true,"illustrations":[{"id":"character",`+properties+`}]}`), &cfg.Questions[0]); err != nil {
			t.Fatal(err)
		}
		if err := s.Configure(cfg, 0); err == nil {
			t.Fatalf("invalid illustration accepted: %s", properties)
		}
		if s.Snapshot().Config.Questions[0].Title != "test" {
			t.Fatal("invalid layout overwrote the saved question")
		}
	}
}
