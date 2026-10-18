package netease

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Link struct {
	Kind, ID string
	ShortURL string
}

var shareURL = regexp.MustCompile(`https?://[^\s<>"'（）【】]+`)

func ParseLink(raw string) (Link, error) {
	if len(raw) > 4096 {
		return Link{}, failure("invalid", "网易云分享链接过长")
	}
	candidate := strings.TrimRight(shareURL.FindString(raw), ").,，。")
	u, err := url.Parse(candidate)
	if err != nil || candidate == "" || u.User != nil || u.Port() != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return Link{}, failure("invalid", "请粘贴网易云歌曲或歌单链接")
	}
	switch strings.ToLower(u.Hostname()) {
	case "163cn.tv":
		return Link{ShortURL: u.String()}, nil
	case "music.163.com", "y.music.163.com":
	default:
		return Link{}, failure("invalid", "仅支持网易云音乐分享链接")
	}
	if u.Fragment != "" {
		fragment, err := url.Parse(u.Fragment)
		if err != nil {
			return Link{}, failure("invalid", "网易云链接无效")
		}
		if fragment.Path != "" {
			u.Path = fragment.Path
			u.RawQuery = fragment.RawQuery
		}
	}
	values, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(values["id"]) != 1 || !validID(values.Get("id")) {
		return Link{}, failure("invalid", "网易云链接中缺少有效的歌曲或歌单编号")
	}
	kind := ""
	switch strings.TrimSuffix(u.Path, "/") {
	case "/song", "/m/song":
		kind = "song"
	case "/playlist", "/m/playlist":
		kind = "playlist"
	}
	if kind == "" {
		return Link{}, failure("invalid", "请使用网易云歌曲或歌单链接")
	}
	return Link{Kind: kind, ID: values.Get("id")}, nil
}
func expandLink(ctx context.Context, link Link) (Link, error) {
	if link.ShortURL == "" {
		return link, nil
	}
	var final Link
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("redirect limit")
		}
		next, err := ParseLink(req.URL.String())
		if err != nil {
			return err
		}
		if next.ShortURL == "" {
			final = next
			return http.ErrUseLastResponse
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, "GET", link.ShortURL, nil)
	if err != nil {
		return Link{}, err
	}
	response, err := client.Do(req)
	if response != nil {
		response.Body.Close()
	}
	if err != nil || final.ID == "" {
		return Link{}, failure("network", "无法展开网易云短链接，请粘贴网页版歌曲或歌单链接")
	}
	return final, nil
}
