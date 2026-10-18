package netease

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

type Service struct {
	caller     Caller
	dir        string
	mu         sync.Mutex
	account    account
	generation uint64
	tasks      map[string]*loginTask
	streams    map[string]Stream
	flights    map[streamKey]*streamFlight
	closed     bool
	now        func() time.Time
	loadError  error
}

func NewService(caller Caller, dir string) *Service {
	s := &Service{caller: caller, dir: dir, tasks: map[string]*loginTask{}, streams: map[string]Stream{}, flights: map[streamKey]*streamFlight{}, now: time.Now}
	s.loadError = s.loadAccount()
	return s
}
func (s *Service) Close() error {
	s.mu.Lock()
	s.closed = true
	s.cancelFlightsLocked()
	s.mu.Unlock()
	return s.caller.Close()
}
func (s *Service) credential() (string, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.account.Cookie, s.generation
}
func (s *Service) call(ctx context.Context, method, cookie string, params map[string]any, out any) error {
	if params == nil {
		params = map[string]any{}
	}
	params["cookie"] = cookie
	params["timestamp"] = s.now().UnixMilli()
	var raw json.RawMessage
	err := s.caller.Call(ctx, method, params, &raw)
	var up *UpstreamError
	if errors.As(err, &up) && up.Code == 301 {
		s.expire(cookie)
		return failure("login", "网易云登录已失效，请重新扫码")
	}
	if err != nil {
		return err
	}
	var envelope struct {
		Code int `json:"code"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		return failure("upstream", "网易云响应格式无效")
	}
	if envelope.Code == 301 {
		s.expire(cookie)
		return failure("login", "网易云需要登录，请扫码后重试")
	}
	// QR status codes 800–803 are meaningful successful responses.
	if envelope.Code != 0 && envelope.Code != 200 && (envelope.Code < 800 || envelope.Code > 803) {
		return failure("upstream", "网易云暂时无法处理请求，请稍后重试")
	}
	if err = json.Unmarshal(raw, out); err != nil {
		return failure("upstream", "网易云响应格式无效")
	}
	return nil
}
func (s *Service) Status(ctx context.Context) (Status, error) {
	if err := s.caller.Ready(); err != nil {
		return Status{Message: err.Error()}, nil
	}
	var health struct {
		Ready bool `json:"ready"`
	}
	if err := s.caller.Call(ctx, "health", map[string]any{}, &health); err != nil {
		return Status{Message: err.Error()}, nil
	}
	cookie, gen := s.credential()
	result := Status{Ready: true}
	if cookie == "" {
		s.mu.Lock()
		loadError := s.loadError
		s.mu.Unlock()
		if loadError != nil {
			result.Message = "网易云账号存档无法读取，请重新扫码登录"
		}
		return result, nil
	}
	profile, err := s.profile(ctx, cookie)
	if err != nil {
		result.Message = err.Error()
		s.mu.Lock()
		if gen == s.generation && s.account.Cookie != "" {
			result.LoggedIn = true
			result.UserID = s.account.Profile.UserID
			result.Nickname = s.account.Profile.Nickname
			result.Avatar = s.account.Profile.Avatar
		}
		s.mu.Unlock()
		return result, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if gen != s.generation {
		return result, nil
	}
	result.LoggedIn = true
	result.UserID = profile.UserID
	result.Nickname = profile.Nickname
	result.Avatar = profile.Avatar
	s.account.Profile = profile
	return result, nil
}

type streamKey struct {
	id         string
	generation uint64
}

type streamFlight struct {
	done   chan struct{}
	cancel context.CancelFunc
	stream Stream
	err    error
}

// Identical host/projection/preload requests share one bounded upstream call.
// Each caller can stop waiting without cancelling playback for another screen.
func (s *Service) Resolve(ctx context.Context, id string) (Stream, error) {
	if !validID(id) {
		return Stream{}, failure("invalid", "歌曲编号无效")
	}
	if err := ctx.Err(); err != nil {
		return Stream{}, err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Stream{}, failure("unavailable", "网易云服务已停止")
	}
	cookie, gen := s.account.Cookie, s.generation
	cached, ok := s.streams[id]
	if ok && cached.generation == gen && cached.ExpiresAt > s.now().Add(30*time.Second).UnixMilli() {
		s.mu.Unlock()
		return cached, nil
	}
	key := streamKey{id, gen}
	flight := s.flights[key]
	if flight == nil {
		if len(s.flights) >= 64 {
			s.mu.Unlock()
			return Stream{}, failure("unavailable", "网易云请求较多，请稍后重试")
		}
		shared, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		flight = &streamFlight{done: make(chan struct{}), cancel: cancel}
		s.flights[key] = flight
		go s.resolveFlight(shared, key, cookie, flight)
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return Stream{}, ctx.Err()
	case <-flight.done:
		s.mu.Lock()
		defer s.mu.Unlock()
		if gen != s.generation {
			return Stream{}, failure("login", "网易云账号状态已变化，请重试")
		}
		return flight.stream, flight.err
	}
}

func (s *Service) resolveFlight(ctx context.Context, key streamKey, cookie string, flight *streamFlight) {
	defer flight.cancel()
	stream, err := s.resolveStream(ctx, key.id, cookie, key.generation)
	s.mu.Lock()
	defer s.mu.Unlock()
	if key.generation != s.generation {
		stream, err = Stream{}, failure("login", "网易云账号状态已变化，请重试")
	} else if s.closed || s.flights[key] != flight {
		stream, err = Stream{}, failure("unavailable", "播放信息已失效，请重试")
	} else if err == nil {
		if len(s.streams) >= 512 {
			s.streams = map[string]Stream{}
		}
		s.streams[key.id] = stream
	}
	if s.flights[key] == flight {
		delete(s.flights, key)
	}
	flight.stream, flight.err = stream, err
	close(flight.done)
}

func (s *Service) cancelFlightsLocked() {
	for key, flight := range s.flights {
		delete(s.flights, key)
		flight.cancel()
	}
}

func (s *Service) resolveStream(ctx context.Context, id, cookie string, gen uint64) (Stream, error) {
	var response struct {
		Data []struct {
			ID            ID              `json:"id"`
			URL           string          `json:"url"`
			Code          int             `json:"code"`
			Expi          int64           `json:"expi"`
			FreeTrialInfo json.RawMessage `json:"freeTrialInfo"`
		} `json:"data"`
	}
	if err := s.call(ctx, "song_url_v1", cookie, map[string]any{"id": id, "level": "standard", "unblock": "false"}, &response); err != nil {
		return Stream{}, err
	}
	if len(response.Data) != 1 || string(response.Data[0].ID) != id {
		return Stream{}, failure("unavailable", "网易云没有返回这首歌的播放信息")
	}
	item := response.Data[0]
	trial := string(item.FreeTrialInfo)
	if trial != "" && trial != "null" && trial != `"null"` && trial != "false" {
		return Stream{}, failure("preview", "这首歌仅提供试听，请登录具有完整播放权限的网易云账号")
	}
	if item.URL == "" || item.Code < 0 {
		if cookie == "" {
			return Stream{}, failure("login", "这首歌暂不能完整播放，请先登录网易云后重试")
		}
		return Stream{}, failure("unavailable", "当前账号无完整播放权限，或歌曲已不可用")
	}
	expi := item.Expi
	if expi <= 0 || expi > 1200 {
		expi = 1200
	}
	stream := Stream{URL: item.URL, ExpiresAt: s.now().Add(time.Duration(expi) * time.Second).UnixMilli(), generation: gen}
	return stream, nil
}
func (s *Service) Invalidate(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.streams, id)
	for key, flight := range s.flights {
		if key.id == id {
			delete(s.flights, key)
			flight.cancel()
		}
	}
}
