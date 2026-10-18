package party

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"time"
)

type Store struct {
	mu    sync.RWMutex
	state State
	path  string
	subs  map[chan struct{}]bool
}

func NewID() string {
	b := make([]byte, 12)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func Open(path string, seed Config) (*Store, error) {
	s := &Store{path: path, subs: map[chan struct{}]bool{}}
	b, err := os.ReadFile(path)
	if err == nil {
		if e := json.Unmarshal(b, &s.state); e != nil {
			return nil, fmt.Errorf("读取存档失败：%w", e)
		}
		migrated := s.state.FormatVersion < 2
		changed := false
		if s.state.FormatVersion < 1 {
			changed = addWarmupBeforeWelcome(&s.state.Config)
		}
		if migrated {
			changed = addOpeningAfterWelcome(&s.state.Config) || changed
			s.state.FormatVersion = 2
			if changed {
				s.state.Revision++
				s.state.ConfigRevision++
			}
		}
		if e := validateConfig(&s.state.Config); e != nil {
			return nil, e
		}
		// Resume safely: browser media and countdown wait for host action after restart.
		if rate := s.state.Session.Media.Rate; rate != 0 && !validPlaybackRate(rate) {
			return nil, fmt.Errorf("读取存档失败：播放倍速无效")
		}
		s.state.Session.Media.Position = s.state.Session.Media.positionAt(time.Now().UnixMilli())
		s.state.Session.Media.Rate = effectivePlaybackRate(s.state.Session.Media.Rate)
		s.state.Session.Media.Status = "paused"
		if d := s.state.Session.Timer.Deadline; d > 0 {
			s.state.Session.Timer.Remaining = max(0, int((d-time.Now().UnixMilli()+999)/1000))
			s.state.Session.Timer.Deadline = 0
		}
		if migrated {
			if e := s.save(s.state); e != nil {
				return nil, e
			}
		}
		if len(s.state.Draws) > 0 {
			d := s.state.Draws[len(s.state.Draws)-1]
			if d.RevealAt > time.Now().UnixMilli() {
				s.scheduleDrawReveal(d.ID, d.RevealAt)
			}
		}
		return s, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	seed = cloneConfig(seed)
	if err = validateConfig(&seed); err != nil {
		return nil, err
	}
	s.state = State{Config: seed, Scores: []Score{}, Draws: []Draw{}, Revision: 1, ConfigRevision: 1, FormatVersion: 2}
	s.state.Session.Media.Status = "paused"
	s.state.Session.Media.Rate = 1
	s.ensureCurrent(&s.state)
	if err = s.save(s.state); err != nil {
		return nil, err
	}
	return s, nil
}

func addOpeningAfterWelcome(cfg *Config) bool {
	welcome := -1
	id := "opening-logos"
	for i, q := range cfg.Questions {
		if q.Presentation == "logos" {
			return false
		}
		if q.ID == "welcome" {
			welcome = i
		}
		if q.ID == id {
			id = NewID()
		}
	}
	if welcome < 0 {
		return false
	}
	q := Question{ID: id, Kind: "intro", Presentation: "logos", Section: "开场", Title: "热爱，在此集结", Body: "重庆大学动漫社 · 偶像研究部", Enabled: true, Options: []string{}, Media: []Media{}}
	cfg.Questions = append(cfg.Questions, Question{})
	copy(cfg.Questions[welcome+2:], cfg.Questions[welcome+1:])
	cfg.Questions[welcome+1] = q
	return true
}

// Upgrade the original event once, without replacing any host-edited pages or logs.
func addWarmupBeforeWelcome(cfg *Config) bool {
	welcome := -1
	id := "warmup"
	for i, q := range cfg.Questions {
		if q.Kind == "warmup" {
			return false
		}
		if q.ID == "welcome" {
			welcome = i
		}
		if q.ID == id {
			id = NewID()
		}
	}
	if welcome < 0 {
		return false
	}
	q := Question{ID: id, Kind: "warmup", Section: "暖场", Title: "入场暖场", Body: "茶话会即将开始，欢迎入座。", Enabled: true, Options: []string{}, Media: []Media{}}
	cfg.Questions = append(cfg.Questions, Question{})
	copy(cfg.Questions[welcome+1:], cfg.Questions[welcome:])
	cfg.Questions[welcome] = q
	return true
}
func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := clone(s.state)
	st.ServerTime = time.Now().UnixMilli()
	return st
}
func (s *Store) save(st State) error {
	if e := os.MkdirAll(filepath.Dir(s.path), 0700); e != nil {
		return e
	}
	b, e := json.MarshalIndent(st, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(s.path), ".state-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return e
	}
	return os.Rename(name, s.path)
}
func (s *Store) commit(st State) error {
	st.Revision = s.state.Revision + 1
	if err := s.save(st); err != nil {
		return fmt.Errorf("保存失败，操作未生效：%w", err)
	}
	s.state = st
	for ch := range s.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *Store) Subscribe() (chan struct{}, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan struct{}, 1)
	s.subs[ch] = true
	return ch, func() { s.mu.Lock(); defer s.mu.Unlock(); delete(s.subs, ch) }
}
func (s *Store) ensureCurrent(st *State) {
	if q := st.Current(); q != nil && q.Enabled {
		return
	}
	for _, q := range st.Config.Questions {
		if q.Enabled {
			st.Session.CurrentID = q.ID
			st.Session.Revealed = false
			st.Session.VideoFullscreen = false
			st.Session.PresentationStartedAt = time.Now().UnixMilli()
			st.Session.Media = Playback{Status: "paused", Rate: 1, Seq: st.Session.Media.Seq + 1}
			return
		}
	}
}
func (s *Store) Configure(cfg Config, revision int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if revision != 0 && revision != s.state.ConfigRevision {
		return fmt.Errorf("题库已在其他窗口修改，请重新载入后再保存")
	}
	cfg = cloneConfig(cfg)
	if err := validateConfig(&cfg); err != nil {
		return err
	}
	teamIDs := map[string]bool{}
	for _, t := range cfg.Teams {
		teamIDs[t.ID] = true
	}
	for _, v := range s.state.Scores {
		if !teamIDs[v.TeamID] {
			return fmt.Errorf("请先撤销该组的计分记录再删除组别")
		}
	}
	st := clone(s.state)
	old := st.Current()
	st.Config = cfg
	if !reflect.DeepEqual(old, st.Current()) {
		st.Session.Revealed = false
		st.Session.VideoFullscreen = false
		st.Session.Media = Playback{Status: "paused", Rate: 1, Seq: st.Session.Media.Seq + 1}
		st.Session.Timer = Timer{}
		st.Session.PresentationStartedAt = time.Now().UnixMilli()
	}
	if !reflect.DeepEqual(s.state.Config.Lottery, cfg.Lottery) {
		if len(s.state.Draws) > 0 && s.state.Draws[len(s.state.Draws)-1].RevealAt > time.Now().UnixMilli() {
			return fmt.Errorf("抽签正在进行，请等待结果后再修改设置")
		}
		st.Draws = []Draw{}
		st.Session.LotteryVisible = false
		st.Session.LotteryIntro = false
	}
	st.ConfigRevision++
	s.ensureCurrent(&st)
	return s.commit(st)
}
func (s *Store) Public() PublicState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st := s.state
	now := time.Now().UnixMilli()
	p := PublicState{Settings: st.Config.Settings, Teams: []PublicTeam{}, Session: st.Session, Revision: st.Revision, ServerTime: now}
	p.Preload = nextPreloadPlan(st)
	scores := make(map[string]int, len(st.Config.Teams))
	for _, score := range st.Scores {
		scores[score.TeamID] += score.Delta
	}
	for _, t := range st.Config.Teams {
		p.Teams = append(p.Teams, PublicTeam{t, scores[t.ID]})
	}
	for _, q := range st.Config.Questions {
		if q.Enabled {
			p.Total++
			if q.ID == st.Session.CurrentID {
				p.Page = p.Total
			}
		}
	}
	if current := st.Current(); current != nil {
		owned := cloneQuestion(*current)
		q := &owned
		q.Source = ""
		q.Review = ""
		if !st.Session.Revealed {
			q.Answer = ""
			q.Explanation = ""
		}
		m := []Media{}
		for _, v := range q.Media {
			if !v.AnswerOnly || st.Session.Revealed {
				m = append(m, v)
			}
		}
		q.Media = m
		p.Question = q
	}
	p.Lottery = lotteryPresentation(st, now)
	if st.Session.LotteryVisible && !st.Session.LotteryIntro && len(st.Draws) > 0 {
		d := st.Draws[len(st.Draws)-1]
		if d.RevealAt <= now {
			d.Values = append([]string(nil), d.Values...)
			p.Draw = &d
		}
	}
	return p
}

func (s *Store) scheduleDrawReveal(id string, deadline int64) {
	time.AfterFunc(time.Until(time.UnixMilli(deadline)), func() {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if len(s.state.Draws) == 0 {
			return
		}
		d := s.state.Draws[len(s.state.Draws)-1]
		if d.ID != id || d.RevealAt != deadline {
			return
		}
		for ch := range s.subs {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	})
}

func lotteryPresentation(st State, now int64) *LotteryView {
	if !st.Session.LotteryVisible {
		return nil
	}
	c := st.Config.Lottery
	v := &LotteryView{Phase: "intro", Mode: c.Mode, Count: c.Count, Min: c.Min, Max: c.Max, Candidates: []string{}, Used: []string{}}
	var current *Draw
	if !st.Session.LotteryIntro && len(st.Draws) > 0 {
		d := st.Draws[len(st.Draws)-1]
		current = &d
		v.DrawID = d.ID
		v.StartedAt = d.At
		v.RevealAt = d.RevealAt
		v.Count = len(d.Values)
		// The reel needs its endpoint before reveal so its final row is the
		// actual draw. PublicState.Draw remains gated by the reveal deadline.
		v.LandingValues = append([]string(nil), d.Values...)
		v.Phase = "result"
		if d.RevealAt > now {
			v.Phase = "rolling"
		}
	}
	used := map[string]bool{}
	if c.NoRepeat {
		for _, d := range st.Draws {
			// Keep this round's track unchanged when its phase becomes result.
			if d.Mode != c.Mode || (current != nil && current.ID == d.ID) {
				continue
			}
			for _, value := range d.Values {
				if !used[value] {
					used[value] = true
					v.Used = append(v.Used, value)
				}
			}
		}
	}
	for _, name := range c.Names {
		if !used[name] {
			v.Candidates = append(v.Candidates, name)
		}
	}
	return v
}
func randomInt(n int64) (int64, error) {
	x, e := rand.Int(rand.Reader, big.NewInt(n))
	if e != nil {
		return 0, e
	}
	return x.Int64(), nil
}
