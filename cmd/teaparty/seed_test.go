package main

import (
	"ef-teaparty/internal/party"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSourceOnlyStartup(t *testing.T) {
	t.Chdir(t.TempDir())
	cfg, err := loadSeed("")
	if err != nil {
		t.Fatal(err)
	}
	store, err := party.Open(filepath.Join(t.TempDir(), "state.json"), cfg)
	if err != nil {
		t.Fatal(err)
	}
	st := store.Snapshot()
	if len(st.Config.Questions) != 4 || st.Session.CurrentID != "warmup" || len(st.Scores) != 0 || len(st.Draws) != 0 {
		t.Fatal("blank startup must contain only scaffold pages and no activity history")
	}
	if st.Config.Settings.Background != "" || len(st.Config.Lottery.Names) != 0 {
		t.Fatal("blank startup must not depend on private assets or nicknames")
	}
	for _, q := range st.Config.Questions {
		if len(q.Media) != 0 || len(q.Illustrations) != 0 || q.Answer != "" || q.Source != "" {
			t.Fatal("blank startup must not include the host's questions or media")
		}
	}
}

func TestLocalSeedStillTakesPrecedence(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.Mkdir("assets", 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("assets/seed.json", []byte(`{"settings":{"title":"Local activity"},"questions":[{"id":"local","kind":"intro","title":"Local page","enabled":true}]}`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadSeed("")
	if err != nil || cfg.Settings.Title != "Local activity" || cfg.Questions[0].ID != "local" {
		t.Fatalf("local seed was not retained: %+v, %v", cfg, err)
	}
	if err := os.WriteFile("other.json", []byte(`{"settings":{"title":"Explicit activity"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = loadSeed("other.json")
	if err != nil || cfg.Settings.Title != "Explicit activity" {
		t.Fatalf("explicit seed was not used: %+v, %v", cfg, err)
	}
}

func TestSeedFailuresAreNotSilentlyReplaced(t *testing.T) {
	t.Chdir(t.TempDir())
	if _, err := loadSeed("missing.json"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("explicit missing seed must fail: %v", err)
	}
	if err := os.Mkdir("assets", 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("assets/seed.json", []byte(`{"settings":`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadSeed(""); err == nil {
		t.Fatal("a damaged local seed must fail instead of resetting the activity")
	}
}
