package netease

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type fixtureCaller struct {
	fn func(context.Context, string, map[string]any) (any, error)
}

func (f fixtureCaller) Ready() error { return nil }
func (f fixtureCaller) Close() error { return nil }
func (f fixtureCaller) Call(ctx context.Context, method string, params any, out any) error {
	m := params.(map[string]any)
	if m["unblock"] == "true" {
		return errors.New("unexpected alternate source")
	}
	result, err := f.fn(ctx, method, m)
	if err != nil {
		return err
	}
	b, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
func TestLoginOwnershipPersistenceAndLogoutRace(t *testing.T) {
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "private")
	var mu sync.Mutex
	code := 801
	entered, resume := make(chan struct{}), make(chan struct{})
	block := false
	caller := fixtureCaller{fn: func(ctx context.Context, method string, p map[string]any) (any, error) {
		switch method {
		case "health":
			return map[string]any{"ready": true}, nil
		case "login_qr_key":
			return map[string]any{"code": 200, "data": map[string]any{"code": 200, "unikey": "key"}}, nil
		case "login_qr_create":
			return map[string]any{"code": 200, "data": map[string]any{"qrimg": "data:image/png;base64,QR"}}, nil
		case "login_qr_check":
			mu.Lock()
			c, b := code, block
			mu.Unlock()
			if b {
				close(entered)
				<-resume
			}
			return map[string]any{"code": c, "cookie": "MUSIC_U=PRIVATE_SECRET; __csrf=token"}, nil
		case "login_status":
			return map[string]any{"data": map[string]any{"code": 200, "profile": map[string]any{"userId": 42, "nickname": "主持人", "avatarUrl": "https://p1.music.126.net/cover.jpg"}}}, nil
		}
		return nil, errors.New("unexpected " + method)
	}}
	s := NewService(caller, dir)
	login, err := s.StartLogin(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CheckLogin(ctx, "other", login.Task); err == nil {
		t.Fatal("task owner ignored")
	}
	waiting, err := s.CheckLogin(ctx, "owner", login.Task)
	if err != nil || waiting.State != "waiting" {
		t.Fatalf("waiting: %+v %v", waiting, err)
	}
	mu.Lock()
	code = 802
	mu.Unlock()
	scanned, err := s.CheckLogin(ctx, "owner", login.Task)
	if err != nil || scanned.State != "scanned" {
		t.Fatalf("scanned: %+v %v", scanned, err)
	}
	mu.Lock()
	code = 803
	mu.Unlock()
	success, err := s.CheckLogin(ctx, "owner", login.Task)
	if err != nil || success.State != "authorized" {
		t.Fatalf("authorize: %+v %v", success, err)
	}
	status, err := s.Status(ctx)
	if err != nil || !status.LoggedIn || status.Nickname != "主持人" {
		t.Fatalf("status: %+v %v", status, err)
	}
	raw, _ := json.Marshal(status)
	if strings.Contains(string(raw), "PRIVATE_SECRET") {
		t.Fatal("credential in DTO")
	}
	path := filepath.Join(dir, "account.json")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("credential permissions: %v %v", info, err)
	}
	again := NewService(caller, dir)
	loaded, err := again.Status(ctx)
	if err != nil || !loaded.LoggedIn {
		t.Fatalf("persistence: %+v %v", loaded, err)
	}
	login, err = s.StartLogin(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	block = true
	mu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := s.CheckLogin(ctx, "owner", login.Task); done <- err }()
	<-entered
	if err = s.Logout(); err != nil {
		t.Fatal(err)
	}
	close(resume)
	if err = <-done; err == nil {
		t.Fatal("stale QR result accepted after logout")
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("credential retained after logout: %v", err)
	}
	loaded, _ = s.Status(ctx)
	if loaded.LoggedIn {
		t.Fatal("logout raced with check")
	}
}

func TestImportPaginationAndFullSongAvailability(t *testing.T) {
	ctx := context.Background()
	calls := 0
	trial := false
	s := NewService(fixtureCaller{fn: func(ctx context.Context, method string, p map[string]any) (any, error) {
		switch method {
		case "playlist_detail":
			return map[string]any{"code": 200, "playlist": map[string]any{"name": "暖场曲", "trackIds": []any{map[string]any{"id": 1}, map[string]any{"id": 2}, map[string]any{"id": 3}}}}, nil
		case "song_detail":
			if p["ids"] != "3" {
				t.Errorf("incorrect page IDs: %v", p["ids"])
			}
			return map[string]any{"code": 200, "songs": []any{map[string]any{"id": 3, "name": "第三首", "dt": 180000, "ar": []any{map[string]any{"name": "歌手"}}, "al": map[string]any{"name": "专辑", "picUrl": "https://p1.music.126.net/cover.jpg"}}}}, nil
		case "song_url_v1":
			calls++
			var preview any
			if trial {
				preview = map[string]any{"start": 0, "end": 30000}
			}
			return map[string]any{"code": 200, "data": []any{map[string]any{"id": 3, "url": "https://m801.music.126.net/test.mp3", "expi": 1200, "code": 200, "freeTrialInfo": preview}}}, nil
		}
		return nil, errors.New("unexpected " + method)
	}}, t.TempDir())
	page, err := s.Import(ctx, "分享歌单 https://music.163.com/#/playlist?id=9", 2)
	if err != nil || page.Total != 3 || len(page.Tracks) != 1 || page.Tracks[0].ID != "3" || page.Tracks[0].Duration != 180 {
		t.Fatalf("page: %+v %v", page, err)
	}
	stream, err := s.Resolve(ctx, "3")
	if err != nil || stream.URL == "" {
		t.Fatalf("full song: %+v %v", stream, err)
	}
	_, _ = s.Resolve(ctx, "3")
	if calls != 1 {
		t.Fatalf("stream cache ignored: %d", calls)
	}
	s.Invalidate("3")
	trial = true
	if _, err = s.Resolve(ctx, "3"); err == nil || !strings.Contains(err.Error(), "试听") {
		t.Fatalf("preview offered as full song: %v", err)
	}
	s.Invalidate("3")
	trial = false
	s.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if _, err = s.Resolve(ctx, "3"); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("expired url reused: %d", calls)
	}
}

func TestLoginCanceledAndExpired(t *testing.T) {
	now := time.Now()
	s := NewService(fixtureCaller{fn: func(_ context.Context, method string, _ map[string]any) (any, error) {
		if method == "login_qr_key" {
			return map[string]any{"code": 200, "data": map[string]any{"unikey": "key"}}, nil
		}
		return map[string]any{"code": 200, "data": map[string]any{"qrimg": "data:image/png;base64,QR"}}, nil
	}}, t.TempDir())
	s.now = func() time.Time { return now }
	q, err := s.StartLogin(context.Background(), "owner")
	if err != nil {
		t.Fatal(err)
	}
	s.CancelOwner("owner")
	if _, err = s.CheckLogin(context.Background(), "owner", q.Task); err == nil {
		t.Fatal("canceled QR accepted")
	}
	q, err = s.StartLogin(context.Background(), "owner")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(4 * time.Minute)
	q, err = s.CheckLogin(context.Background(), "owner", q.Task)
	if err != nil || q.State != "expired" {
		t.Fatalf("QR expiry: %+v %v", q, err)
	}
}

func TestStatusConcurrentWithLogout(t *testing.T) {
	s := NewService(fixtureCaller{fn: func(_ context.Context, _ string, _ map[string]any) (any, error) {
		return map[string]any{"ready": true}, nil
	}}, t.TempDir())
	s.loadError = errors.New("unreadable prior account")
	var group sync.WaitGroup
	group.Add(2)
	start := make(chan struct{})
	go func() {
		defer group.Done()
		<-start
		for range 10000 {
			_ = s.Logout()
		}
	}()
	go func() {
		defer group.Done()
		<-start
		for range 10000 {
			status, err := s.Status(context.Background())
			if err != nil || status.LoggedIn {
				t.Errorf("logout status: %+v %v", status, err)
			}
		}
	}()
	close(start)
	group.Wait()
}

func TestTransientStatusFailureKeepsSavedAccount(t *testing.T) {
	dir := t.TempDir()
	raw := []byte(`{"cookie":"MUSIC_U=saved","profile":{"userId":"42","nickname":"主持人","avatarUrl":""}}`)
	if err := os.WriteFile(filepath.Join(dir, "account.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	s := NewService(fixtureCaller{fn: func(_ context.Context, method string, _ map[string]any) (any, error) {
		if method == "health" {
			return map[string]any{"ready": true}, nil
		}
		return nil, context.DeadlineExceeded
	}}, dir)
	status, err := s.Status(context.Background())
	if err != nil || !status.LoggedIn || status.Nickname != "主持人" || status.Message == "" {
		t.Fatalf("temporary outage lost account state: %+v %v", status, err)
	}
}
