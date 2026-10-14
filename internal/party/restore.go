package party

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const maxRestoreNumber int64 = 9007199254740990
const maxRestoreTime int64 = 253402300799999

// ValidateRestore checks the entire private activity state, not just its configuration.
// snapshotAt is the time at which the archive captured the state.
func ValidateRestore(st State, snapshotAt int64) error {
	_, err := prepareRestore(st, snapshotAt)
	return err
}

func prepareRestore(st State, snapshotAt int64) (State, error) {
	bad := func(message string) (State, error) { return State{}, fmt.Errorf("归档状态无效：%s", message) }
	if snapshotAt <= 0 || snapshotAt > maxRestoreTime || st.FormatVersion != 2 || st.Revision < 1 || st.Revision > maxRestoreNumber || st.ConfigRevision < 1 || st.ConfigRevision > maxRestoreNumber {
		return bad("版本或快照时间不受支持")
	}
	// Marshal also rejects non-finite float values supplied by in-process callers.
	raw, err := json.Marshal(st)
	if err != nil {
		return bad("含有无效数值")
	}
	if err = json.Unmarshal(raw, &st); err != nil {
		return bad("无法读取状态")
	}
	if err = validateConfig(&st.Config); err != nil {
		return State{}, err
	}
	if len(st.Scores) > 100000 || len(st.Draws) > 100000 {
		return bad("记录数量超出限制")
	}
	teams := map[string]bool{}
	for _, team := range st.Config.Teams {
		teams[team.ID] = true
	}
	ids := map[string]bool{}
	for _, score := range st.Scores {
		if !idPattern.MatchString(score.ID) || ids[score.ID] || !teams[score.TeamID] || (score.QuestionID != "" && !idPattern.MatchString(score.QuestionID)) {
			return bad("计分记录引用的组别或 ID 无效")
		}
		ids[score.ID] = true
		if score.Delta < -1000000 || score.Delta > 1000000 || score.PlayerDelta < -1000000 || score.PlayerDelta > 1000000 || (score.Player == "" && score.PlayerDelta != 0) || len(score.Player) > 200 || len(score.Note) > 2000 || score.At < 0 || score.At > snapshotAt {
			return bad("计分记录数值或时间无效")
		}
	}
	ids = map[string]bool{}
	used := map[string]bool{}
	names := map[string]bool{}
	for _, name := range st.Config.Lottery.Names {
		names[name] = true
	}
	for i := range st.Draws {
		d := &st.Draws[i]
		if !idPattern.MatchString(d.ID) || ids[d.ID] || d.Mode != st.Config.Lottery.Mode || len(d.Values) < 1 || len(d.Values) > 50 || d.At < 0 || d.At > snapshotAt || d.RevealAt < 0 || d.RevealAt > maxRestoreTime || (d.RevealAt != 0 && d.RevealAt < d.At) {
			return bad("抽签记录 ID、模式或时间无效")
		}
		ids[d.ID] = true
		local := map[string]bool{}
		for _, value := range d.Values {
			if local[value] || (st.Config.Lottery.NoRepeat && used[value]) {
				return bad("抽签记录含有重复结果")
			}
			local[value] = true
			used[value] = true
			if d.Mode == "names" {
				if !names[value] {
					return bad("抽签结果不在昵称池中")
				}
			} else {
				n, e := strconv.ParseInt(value, 10, 64)
				if e != nil || strconv.FormatInt(n, 10) != value || n < int64(st.Config.Lottery.Min) || n > int64(st.Config.Lottery.Max) {
					return bad("抽签结果不在数字池中")
				}
			}
		}
		// A completed imported draw must not resume a stale reveal animation.
		if d.RevealAt > snapshotAt {
			d.RevealAt = d.At
		}
	}
	q := st.Current()
	if q == nil || !q.Enabled {
		return bad("当前页面不存在或未启用")
	}
	p := &st.Session.Media
	media := playableMedia(q, st.Session.Revealed)
	if p.Rate != 0 && !validPlaybackRate(p.Rate) {
		return bad("播放倍速无效")
	}
	if (p.Status != "paused" && p.Status != "playing") || math.IsNaN(p.Position) || math.IsInf(p.Position, 0) || p.Position < 0 || p.Position > float64(maxRestoreNumber) || p.Seq < 0 || p.Seq > maxRestoreNumber || p.UpdatedAt < 0 || p.UpdatedAt > maxRestoreTime || p.Index < 0 || (len(media) == 0 && p.Index != 0) || (len(media) > 0 && p.Index >= len(media)) {
		return bad("播放状态或素材索引无效")
	}
	if len(media) == 0 && p.Status == "playing" {
		return bad("当前页面没有可播放素材")
	}
	p.Position = p.positionAt(snapshotAt)
	p.Rate = effectivePlaybackRate(p.Rate)
	if len(media) > 0 {
		m := media[p.Index]
		p.Position = max(p.Position, m.Start)
		if m.End > 0 {
			p.Position = min(p.Position, m.End)
		}
	}
	p.Status = "paused"
	timer := &st.Session.Timer
	if timer.Remaining < 0 || timer.Remaining > 86400 || timer.Duration < 0 || timer.Duration > 86400 || timer.Deadline < 0 || timer.Deadline > maxRestoreTime {
		return bad("倒计时数值无效")
	}
	if timer.Deadline > 0 {
		remaining := max(int64(0), (timer.Deadline-snapshotAt+999)/1000)
		if remaining > 86400 {
			return bad("倒计时超出一天")
		}
		timer.Remaining = int(remaining)
		timer.Deadline = 0
	}
	if st.Session.PresentationStartedAt < 0 || st.Session.PresentationStartedAt > maxRestoreTime {
		return bad("开场时间无效")
	}
	if st.Session.LotteryVisible && !st.Session.LotteryIntro && len(st.Draws) == 0 {
		return bad("抽签展示缺少对应记录")
	}
	if st.Scores == nil {
		st.Scores = []Score{}
	}
	if st.Draws == nil {
		st.Draws = []Draw{}
	}
	st.Session.VideoFullscreen = false
	return st, nil
}

// Restore atomically replaces the state only if the preview's live revision is still current.
// A private, automatic backup is durably written before replacing the active state.
func (s *Store) Restore(source State, snapshotAt, expectedRevision int64) error {
	st, err := prepareRestore(source, snapshotAt)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if expectedRevision != s.state.Revision {
		return fmt.Errorf("活动已在预检后发生变化，请重新预检归档后再恢复")
	}
	if s.state.Revision >= maxRestoreNumber || s.state.ConfigRevision >= maxRestoreNumber || s.state.Session.Media.Seq >= maxRestoreNumber {
		return fmt.Errorf("状态版本超出范围，无法恢复")
	}
	now := time.Now().UnixMilli()
	st.ConfigRevision = max(st.ConfigRevision, s.state.ConfigRevision) + 1
	st.Session.Media.Seq = max(st.Session.Media.Seq, s.state.Session.Media.Seq) + 1
	st.Session.Media.UpdatedAt = now
	st.Session.PresentationStartedAt = now
	st.ServerTime = 0
	backup := clone(s.state)
	backup.ServerTime = now
	raw, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), "pre-restore-*.json")
	if err != nil {
		return fmt.Errorf("无法创建恢复前备份：%w", err)
	}
	backupPath := f.Name()
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(backupPath)
		return fmt.Errorf("无法保存恢复前备份：%w", err)
	}
	if err = s.commit(st); err != nil {
		_ = os.Remove(backupPath)
		return err
	}
	return nil
}
