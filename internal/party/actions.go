package party

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func (s *Store) Apply(a Action) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := clone(s.state)
	now := time.Now().UnixMilli()
	q := st.Current()
	var pending *Draw
	switch a.Op {
	case "judge", "reveal", "timerStart", "timerPause", "timerReset", "play", "pause", "seek", "replay", "rate", "videoFullscreen", "replayPresentation":
		if q == nil || a.ID != st.Session.CurrentID {
			return fmt.Errorf("题目已切换，请确认当前页后重试")
		}
	}
	switch a.Op {
	case "next", "prev", "goto":
		ids := []string{}
		current := 0
		for _, v := range st.Config.Questions {
			if v.Enabled {
				if v.ID == st.Session.CurrentID {
					current = len(ids)
				}
				ids = append(ids, v.ID)
			}
		}
		target := ""
		if a.Op == "goto" {
			for _, id := range ids {
				if a.ID == id {
					target = id
					break
				}
			}
		} else {
			step := 1
			if a.Op == "prev" {
				step = -1
			}
			i := current + step
			if i >= 0 && i < len(ids) {
				target = ids[i]
			}
		}
		if target == "" {
			return fmt.Errorf("没有可切换的页面")
		}
		st.Session = Session{CurrentID: target, PresentationStartedAt: now, Media: Playback{Status: "paused", Rate: 1, UpdatedAt: now, Seq: st.Session.Media.Seq + 1}}
	case "replayPresentation":
		if q.Kind != "intro" || q.Presentation != "logos" {
			return fmt.Errorf("当前页面没有开场动画")
		}
		st.Session.PresentationStartedAt = max(now, st.Session.PresentationStartedAt+1)
		st.Session.LotteryVisible = false
		st.Session.LotteryIntro = false
	case "reveal":
		before := playableMedia(q, st.Session.Revealed)
		selectedID := ""
		if i := st.Session.Media.Index; i >= 0 && i < len(before) {
			selectedID = before[i].ID
		}
		st.Session.Revealed = !st.Session.Revealed
		after := playableMedia(q, st.Session.Revealed)
		index := -1
		for i, m := range after {
			if m.ID == selectedID {
				index = i
				break
			}
		}
		if index >= 0 {
			st.Session.Media.Index = index
			st.Session.Media.Seq++
		} else {
			position := 0.0
			if len(after) > 0 {
				position = after[0].Start
			}
			st.Session.Media = Playback{Status: "paused", Rate: 1, Position: position, UpdatedAt: now, Seq: st.Session.Media.Seq + 1}
		}
		if i := st.Session.Media.Index; i < 0 || i >= len(after) || after[i].Kind != "video" {
			st.Session.VideoFullscreen = false
		}
	case "judge", "adjust":
		found := false
		for _, t := range st.Config.Teams {
			if t.ID == a.TeamID {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("请选择有效组别")
		}
		if len(a.Player) > 200 || len(a.Note) > 1000 {
			return fmt.Errorf("昵称或备注过长")
		}
		v := Score{ID: NewID(), TeamID: a.TeamID, Delta: a.Delta, PlayerDelta: a.PlayerDelta, Player: strings.TrimSpace(a.Player), Note: a.Note, At: now}
		if a.Op == "judge" {
			if q == nil || q.Kind == "warmup" || q.Kind == "intro" || q.Kind == "score" {
				return fmt.Errorf("当前页面不是计分题")
			}
			v.QuestionID = q.ID
			v.Correct = a.Correct
			v.Delta = q.WrongPoints
			v.PlayerDelta = q.PlayerWrongPoints
			if a.Correct {
				v.Delta = q.Points
				v.PlayerDelta = q.PlayerPoints
			}
			v.Note = q.Title
			next := []Score{}
			for _, old := range st.Scores {
				if old.TeamID != a.TeamID || old.QuestionID != q.ID {
					next = append(next, old)
				}
			}
			st.Scores = next
		} else if a.Delta < -1000000 || a.Delta > 1000000 || a.PlayerDelta < -1000000 || a.PlayerDelta > 1000000 || (a.Delta == 0 && a.PlayerDelta == 0) {
			return fmt.Errorf("团队或个人调整需至少一项非零，范围 ±1000000")
		} else if v.Player == "" && a.PlayerDelta != 0 {
			return fmt.Errorf("记录个人积分时请填写昵称")
		}
		if v.Player == "" {
			v.PlayerDelta = 0
		}
		st.Scores = append(st.Scores, v)
	case "undo":
		found := false
		next := []Score{}
		for _, v := range st.Scores {
			if v.ID == a.ID {
				found = true
			} else {
				next = append(next, v)
			}
		}
		if !found {
			return fmt.Errorf("计分记录不存在")
		}
		st.Scores = next
	case "clearScores":
		st.Scores = []Score{}
	case "timerStart", "timerPause", "timerReset":
		if a.Op == "timerPause" {
			if st.Session.Timer.Deadline > 0 {
				st.Session.Timer.Remaining = max(0, int((st.Session.Timer.Deadline-now+999)/1000))
				st.Session.Timer.Deadline = 0
			}
		}
		if a.Op == "timerReset" {
			seconds := a.Seconds
			if seconds == 0 && q != nil {
				seconds = q.Duration
			}
			if seconds < 0 || seconds > 86400 {
				return fmt.Errorf("计时必须为 0–86400 秒")
			}
			st.Session.Timer = Timer{Remaining: seconds, Duration: seconds}
		}
		if a.Op == "timerStart" {
			if a.Seconds < 0 || a.Seconds > 86400 {
				return fmt.Errorf("请设置有效计时时长")
			}
			seconds := st.Session.Timer.Remaining
			if a.Seconds > 0 {
				seconds = a.Seconds
			}
			if seconds <= 0 && q != nil {
				seconds = q.Duration
			}
			if seconds <= 0 || seconds > 86400 {
				return fmt.Errorf("请设置有效计时时长")
			}
			duration := st.Session.Timer.Duration
			if a.Seconds > 0 || duration <= 0 {
				duration = seconds
			}
			st.Session.Timer = Timer{Remaining: seconds, Deadline: now + int64(seconds)*1000, Duration: duration}
		}
	case "videoFullscreen":
		if a.Enabled {
			media := playableMedia(q, st.Session.Revealed)
			index := st.Session.Media.Index
			if index < 0 || index >= len(media) || media[index].Kind != "video" {
				return fmt.Errorf("当前素材不是视频")
			}
		}
		st.Session.VideoFullscreen = a.Enabled
	case "rate":
		if !validPlaybackRate(a.Rate) {
			return fmt.Errorf("播放倍速必须为 0.5–2 倍")
		}
		p := st.Session.Media
		if a.Seq != nil && *a.Seq != p.Seq {
			return fmt.Errorf("播放状态已更新，请重试")
		}
		media := playableMedia(q, st.Session.Revealed)
		if a.Index != p.Index || a.Index < 0 || a.Index >= len(media) || media[a.Index].Kind != "video" {
			return fmt.Errorf("当前选中素材不是该视频，请重新确认")
		}
		p.Position = p.positionAt(now)
		if end := media[a.Index].End; end > 0 {
			p.Position = min(p.Position, end)
		}
		p.Position = max(p.Position, media[a.Index].Start)
		// Keep an already announced future cue unchanged while preparing video.
		if p.Status != "playing" || p.UpdatedAt <= now {
			p.UpdatedAt = now
		}
		p.Rate = a.Rate
		p.Seq++
		st.Session.Media = p
	case "play", "pause", "seek", "replay":
		if a.Delay != 0 && a.Delay != 3 {
			return fmt.Errorf("播放准备时间仅支持 0 或 3 秒")
		}
		if a.Seq != nil && *a.Seq != st.Session.Media.Seq {
			return fmt.Errorf("播放状态已更新，请重试")
		}
		media := playableMedia(q, st.Session.Revealed)
		if a.Index < 0 || a.Index >= len(media) {
			return fmt.Errorf("当前页没有该音视频素材")
		}
		m := media[a.Index]
		p := st.Session.Media
		p.Position = p.positionAt(now)
		p.Rate = effectivePlaybackRate(p.Rate)
		if p.Index != a.Index {
			p.Position = m.Start
			p.Rate = 1
		}
		if p.Position < m.Start {
			p.Position = m.Start
		}
		if a.Op == "seek" {
			if math.IsNaN(a.Position) || math.IsInf(a.Position, 0) || a.Position < m.Start || (m.End > 0 && a.Position > m.End) {
				return fmt.Errorf("播放位置超出片段范围")
			}
			p.Position = a.Position
			if p.UpdatedAt > now {
				p.Status = "paused"
			}
		}
		if a.Op == "replay" {
			p.Position = m.Start
		}
		if a.Op == "play" || a.Op == "replay" {
			if m.End > 0 && p.Position >= m.End {
				p.Position = m.Start
			}
			p.Status = "playing"
		}
		if a.Op == "pause" {
			p.Status = "paused"
			if a.Position > 0 {
				p.Position = a.Position
			}
		}
		if m.End > 0 && p.Position > m.End {
			p.Position = m.End
		}
		p.Index = a.Index
		p.UpdatedAt = now
		if a.Op == "play" || a.Op == "replay" {
			// A future timestamp lets every projection start from the same cue.
			p.UpdatedAt += int64(a.Delay) * 1000
			if a.Delay == 0 && m.Kind == "video" {
				p.UpdatedAt += 300
			}
		}
		p.Seq++
		st.Session.Media = p
		if m.Kind != "video" {
			st.Session.VideoFullscreen = false
		}
	case "showLottery":
		pauseForLottery(&st, now)
		st.Session.LotteryVisible = true
		st.Session.LotteryIntro = true
	case "draw":
		if len(st.Draws) > 0 && st.Draws[len(st.Draws)-1].RevealAt > now {
			return fmt.Errorf("抽签正在进行，请等待本轮结果")
		}
		d, e := draw(st.Config.Lottery, st.Draws)
		if e != nil {
			return e
		}
		d.ID = NewID()
		d.At = now
		seconds, e := randomInt(6)
		if e != nil {
			return e
		}
		d.RevealAt = now + (5+seconds)*1000
		pauseForLottery(&st, now)
		st.Draws = append(st.Draws, d)
		st.Session.LotteryVisible = true
		st.Session.LotteryIntro = false
		pending = &d
	case "hideDraw":
		st.Session.LotteryVisible = false
		st.Session.LotteryIntro = false
	case "resetDraws":
		if len(st.Draws) > 0 && st.Draws[len(st.Draws)-1].RevealAt > now {
			return fmt.Errorf("请等待本轮抽签结束后重置")
		}
		st.Draws = []Draw{}
		st.Session.LotteryVisible = false
		st.Session.LotteryIntro = false
	default:
		return fmt.Errorf("未知操作：%s", a.Op)
	}
	if err := s.commit(st); err != nil {
		return err
	}
	if pending != nil {
		s.scheduleDrawReveal(pending.ID, pending.RevealAt)
	}
	return nil
}
func pauseForLottery(st *State, now int64) {
	p := &st.Session.Media
	p.Position = p.positionAt(now)
	p.Status = "paused"
	p.UpdatedAt = now
	p.Seq++
	st.Session.VideoFullscreen = false
	if st.Session.Timer.Deadline > 0 {
		st.Session.Timer.Remaining = max(0, int((st.Session.Timer.Deadline-now+999)/1000))
		st.Session.Timer.Deadline = 0
	}
}
func playableMedia(q *Question, revealed bool) []Media {
	media := []Media{}
	if q != nil {
		for _, m := range q.Media {
			if m.Kind != "image" && (!m.AnswerOnly || revealed) {
				media = append(media, m)
			}
		}
	}
	return media
}
func draw(c LotteryConfig, history []Draw) (Draw, error) {
	d := Draw{Mode: c.Mode, Values: []string{}}
	used := map[string]bool{}
	if c.NoRepeat {
		for _, h := range history {
			if h.Mode == c.Mode {
				for _, v := range h.Values {
					used[v] = true
				}
			}
		}
	}
	if c.Mode == "names" {
		pool := []string{}
		for _, n := range c.Names {
			if !used[n] {
				pool = append(pool, n)
			}
		}
		if len(pool) < c.Count {
			return d, fmt.Errorf("剩余昵称不足 %d 个，请修改数量或重置抽签池", c.Count)
		}
		for i := 0; i < c.Count; i++ {
			n, e := randomInt(int64(len(pool)))
			if e != nil {
				return d, e
			}
			d.Values = append(d.Values, pool[n])
			pool = append(pool[:n], pool[n+1:]...)
		}
		return d, nil
	}
	size := int64(c.Max) - int64(c.Min) + 1
	validUsed := map[int64]bool{}
	for v := range used {
		n, e := strconv.ParseInt(v, 10, 64)
		if e == nil && n >= int64(c.Min) && n <= int64(c.Max) {
			validUsed[n] = true
		}
	}
	if size-int64(len(validUsed)) < int64(c.Count) {
		return d, fmt.Errorf("数字池剩余数量不足，请重置或缩小抽取数量")
	}
	for i := 0; i < c.Count; i++ {
		rank, e := randomInt(size - int64(len(validUsed)))
		if e != nil {
			return d, e
		}
		// Map a uniform free rank to the integer range without allocating the range.
		n := int64(c.Min) + rank
		for {
			blocked := int64(0)
			for v := range validUsed {
				if v <= n {
					blocked++
				}
			}
			next := int64(c.Min) + rank + blocked
			if n == next {
				break
			}
			n = next
		}
		validUsed[n] = true
		d.Values = append(d.Values, strconv.FormatInt(n, 10))
	}
	return d, nil
}
