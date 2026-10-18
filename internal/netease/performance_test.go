package netease

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func fullStream(url string) any {
	return map[string]any{"code": 200, "data": []any{map[string]any{"id": 3, "url": url, "code": 200, "expi": 600, "freeTrialInfo": json.RawMessage(`null`)}}}
}

func TestResolveCoalescesConcurrentRequestsWithoutSharingCancellation(t *testing.T) {
	var calls atomic.Int32
	entered := make(chan struct{}, 32)
	release := make(chan struct{})
	s := NewService(fixtureCaller{fn: func(ctx context.Context, method string, p map[string]any) (any, error) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return fullStream("https://m701.music.126.net/song.mp3"), nil
		}
	}}, t.TempDir())
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	cancelled := make(chan error, 1)
	go func() { _, err := s.Resolve(ctx, "3"); cancelled <- err }()
	<-entered
	done := make(chan error, 16)
	for i := 0; i < 16; i++ {
		go func() {
			stream, err := s.Resolve(context.Background(), "3")
			if err == nil && stream.URL != "https://m701.music.126.net/song.mp3" {
				err = errors.New("wrong shared stream")
			}
			done <- err
		}()
	}
	if err := <-cancelled; !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("caller cancellation: %v", err)
	}
	close(release)
	for i := 0; i < 16; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("same song required %d upstream calls; want 1", calls.Load())
	}
}

func TestInvalidatePreventsInflightStreamFromRefillingCache(t *testing.T) {
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	s := NewService(fixtureCaller{fn: func(ctx context.Context, method string, p map[string]any) (any, error) {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
			return fullStream("https://m701.music.126.net/old.mp3"), nil
		}
		return fullStream("https://m701.music.126.net/new.mp3"), nil
	}}, t.TempDir())
	defer s.Close()
	done := make(chan error, 1)
	go func() { _, err := s.Resolve(context.Background(), "3"); done <- err }()
	<-entered
	s.Invalidate("3")
	fresh, err := s.Resolve(context.Background(), "3")
	close(release)
	if err != nil || fresh.URL != "https://m701.music.126.net/new.mp3" {
		t.Fatalf("fresh result: %v %v", fresh, err)
	}
	if err := <-done; err == nil {
		t.Fatal("invalidated inflight result accepted")
	}
	cached, err := s.Resolve(context.Background(), "3")
	if err != nil || cached.URL != fresh.URL || calls.Load() != 2 {
		t.Fatalf("stale stream refilled cache: %+v %v, calls %d", cached, err, calls.Load())
	}
}

func TestResolveRetriesFailuresAndCloseCancelsWork(t *testing.T) {
	var calls atomic.Int32
	entered := make(chan struct{})
	s := NewService(fixtureCaller{fn: func(ctx context.Context, method string, p map[string]any) (any, error) {
		n := calls.Add(1)
		if n == 1 {
			return nil, errors.New("temporary upstream failure")
		}
		if n == 2 {
			return fullStream("https://m701.music.126.net/song.mp3"), nil
		}
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	}}, t.TempDir())
	if _, err := s.Resolve(context.Background(), "3"); err == nil {
		t.Fatal("failure swallowed")
	}
	if _, err := s.Resolve(context.Background(), "3"); err != nil {
		t.Fatal(err)
	}
	s.Invalidate("3")
	done := make(chan error, 1)
	go func() { _, err := s.Resolve(context.Background(), "3"); done <- err }()
	<-entered
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("close accepted a stream")
		}
	case <-time.After(time.Second):
		t.Fatal("close did not cancel pending resolution")
	}
}
