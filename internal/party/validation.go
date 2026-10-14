package party

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
)

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var colorPattern = regexp.MustCompile(`^#[a-fA-F0-9]{6}$`)

func ValidURL(v string) bool {
	if v == "" {
		return true
	}
	if strings.HasPrefix(v, "/assets/") || strings.HasPrefix(v, "/media/") {
		return !strings.Contains(v, "..") && !strings.ContainsAny(v, "\r\n\\")
	}
	u, e := url.Parse(v)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}
func validateConfig(c *Config) error {
	if c.Teams == nil {
		c.Teams = []Team{}
	}
	if len(strings.TrimSpace(c.Settings.Title)) == 0 || len(c.Settings.Title) > 200 {
		return fmt.Errorf("活动标题必填，最多 200 字节")
	}
	if !ValidURL(c.Settings.Background) {
		return fmt.Errorf("背景地址无效")
	}
	if len(c.Teams) > 50 || len(c.Questions) > 2000 {
		return fmt.Errorf("最多 50 个组和 2000 个页面")
	}
	ids := map[string]bool{}
	for _, t := range c.Teams {
		if !idPattern.MatchString(t.ID) || ids[t.ID] || strings.TrimSpace(t.Name) == "" || !colorPattern.MatchString(t.Color) {
			return fmt.Errorf("组别 ID、名称或颜色无效/重复")
		}
		ids[t.ID] = true
	}
	ids = map[string]bool{}
	enabled := 0
	for i := range c.Questions {
		q := &c.Questions[i]
		if q.Options == nil {
			q.Options = []string{}
		}
		if q.Media == nil {
			q.Media = []Media{}
		}
		if strings.TrimSpace(q.Section) == "" {
			q.Section = "自定义"
		}
		if !idPattern.MatchString(q.ID) || ids[q.ID] || strings.TrimSpace(q.Title) == "" {
			return fmt.Errorf("页面 ID 或标题无效/重复")
		}
		ids[q.ID] = true
		if q.WarmupAudio != nil && (!ValidURL(q.WarmupAudio.Cover) || !ValidURL(q.WarmupAudio.Background)) {
			return fmt.Errorf("暖场 CD 封面或背景地址无效")
		}
		if q.Presentation != "" && (q.Presentation != "logos" || q.Kind != "intro") {
			return fmt.Errorf("开场动画仅适用于开场 / 规则页面")
		}
		if len(q.Illustrations) > 12 || (len(q.Illustrations) > 0 && q.Kind != "intro") {
			return fmt.Errorf("立绘仅适用于开场 / 规则页，每页最多 12 张")
		}
		illustrationIDs := map[string]bool{}
		for _, item := range q.Illustrations {
			if !idPattern.MatchString(item.ID) || illustrationIDs[item.ID] || item.URL == "" || !ValidURL(item.URL) || len(item.Name) > 600 {
				return fmt.Errorf("立绘 ID、名称或地址无效/重复")
			}
			illustrationIDs[item.ID] = true
			for _, number := range []float64{item.X, item.Y, item.Width} {
				if math.IsNaN(number) || math.IsInf(number, 0) {
					return fmt.Errorf("立绘位置和大小必须为有效数值")
				}
			}
			if item.X < 0 || item.X > 100 || item.Y < 0 || item.Y > 100 || item.Width < 2 || item.Width > 100 || (item.Layer != "behind" && item.Layer != "front") {
				return fmt.Errorf("立绘位置需 0–100%%，宽度需 2–100%%，层次需为前层或后层")
			}
		}
		switch q.Kind {
		case "warmup", "intro", "choice", "soup", "song", "draw", "score":
		default:
			return fmt.Errorf("未知页面类型：%s", q.Kind)
		}
		if q.Enabled {
			enabled++
		}
		if q.Points < 0 || q.Points > 1000000 || q.WrongPoints > 0 || q.WrongPoints < -1000000 || q.PlayerPoints < 0 || q.PlayerPoints > 1000000 || q.PlayerWrongPoints > 0 || q.PlayerWrongPoints < -1000000 || q.Duration < 0 || q.Duration > 86400 {
			return fmt.Errorf("加分需 0–1000000，扣分需 -1000000–0，计时需 0–86400 秒")
		}
		if len(q.Title) > 2000 || len(q.Body) > 50000 || len(q.Explanation) > 50000 || len(q.Answer) > 2000 || len(q.Options) > 8 || len(q.Media) > 30 {
			return fmt.Errorf("题目或素材超出大小限制")
		}
		if q.Kind == "choice" && q.Enabled && (len(q.Options) < 2 || len(q.Answer) != 1 || !strings.Contains("ABCDEFGH"[:len(q.Options)], q.Answer)) {
			return fmt.Errorf("启用的单选题需 2–8 个选项及有效答案：%s", q.Title)
		}
		mids := map[string]bool{}
		for _, m := range q.Media {
			if m.WarmupAudio != nil && (!ValidURL(m.WarmupAudio.Cover) || !ValidURL(m.WarmupAudio.Background)) {
				return fmt.Errorf("素材 CD 封面或背景地址无效")
			}
			if len(m.Name) > 600 {
				return fmt.Errorf("素材名称最多 600 字节")
			}
			if !idPattern.MatchString(m.ID) || mids[m.ID] || !ValidURL(m.URL) || m.URL == "" {
				return fmt.Errorf("素材 ID 或地址无效")
			}
			mids[m.ID] = true
			if m.Kind != "image" && m.Kind != "audio" && m.Kind != "video" {
				return fmt.Errorf("素材类型无效")
			}
			if math.IsNaN(m.Start) || math.IsNaN(m.End) || math.IsInf(m.Start, 0) || math.IsInf(m.End, 0) || m.Start < 0 || m.End < 0 || (m.End > 0 && m.End <= m.Start) {
				return fmt.Errorf("片段结束时间必须大于开始时间（0 为播放至结尾）")
			}
		}
	}
	if enabled == 0 {
		return fmt.Errorf("至少启用一个页面")
	}
	if c.Lottery.Mode == "" {
		c.Lottery = LotteryConfig{Mode: "names", Min: 1, Max: 100, Count: 1, NoRepeat: true}
	}
	if c.Lottery.Mode != "names" && c.Lottery.Mode != "numbers" {
		return fmt.Errorf("抽签模式无效")
	}
	if c.Lottery.Min < -1000000000 || c.Lottery.Max > 1000000000 || c.Lottery.Max < c.Lottery.Min {
		return fmt.Errorf("数字范围需在 ±10 亿以内，起始值不得大于结束值")
	}
	if c.Lottery.Count < 1 || c.Lottery.Count > 50 {
		return fmt.Errorf("每次抽取 1–50 个")
	}
	if len(c.Lottery.Names) > 10000 {
		return fmt.Errorf("昵称池最多 10000 个")
	}
	unique := []string{}
	seen := map[string]bool{}
	for _, n := range c.Lottery.Names {
		n = strings.TrimSpace(n)
		if len(n) > 200 {
			return fmt.Errorf("昵称过长")
		}
		if n != "" && !seen[n] {
			seen[n] = true
			unique = append(unique, n)
		}
	}
	c.Lottery.Names = unique
	return nil
}
