package netease

import "testing"

func TestNeteaseLinks(t *testing.T) {
	for _, tc := range []struct{ raw, kind, id string }{
		{"https://music.163.com/#/song?id=347230", "song", "347230"},
		{"分享歌单 https://music.163.com/playlist?id=9&userid=1 （来自网易云）", "playlist", "9"},
		{"https://y.music.163.com/m/song?id=123&uct2=x", "song", "123"},
	} {
		link, err := ParseLink(tc.raw)
		if err != nil || link.Kind != tc.kind || link.ID != tc.id {
			t.Fatalf("%s: %+v %v", tc.raw, link, err)
		}
	}
	for _, raw := range []string{"https://evil.test/song?id=3", "https://music.163.com.evil.test/song?id=3", "https://user@music.163.com/song?id=3", "https://music.163.com/song?id=0", "https://music.163.com:9000/song?id=3", "https://music.163.com/song?id=3&id=4", "https://music.163.com/other?id=3"} {
		if _, err := ParseLink(raw); err == nil {
			t.Fatalf("unsafe link accepted: %s", raw)
		}
	}
}
