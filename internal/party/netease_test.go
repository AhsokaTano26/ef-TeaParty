package party

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestNeteaseMediaValidationAndLimits(t *testing.T) {
	for _, tc := range []struct {
		kind        string
		count       int
		source, raw string
		valid       bool
	}{
		{"warmup", 500, "347230", "/api/netease/audio/347230", true},
		{"warmup", 501, "347230", "/api/netease/audio/347230", false},
		{"intro", 31, "", "/media/local.mp3", false},
		{"warmup", 1, "347230", "/api/netease/audio/42", false},
		{"warmup", 1, "", "/api/netease/audio/347230", false},
		{"warmup", 1, "347230", "/api/netease/audio/347230?cookie=secret", false},
		{"intro", 1, "347230", "/api/netease/audio/347230", false},
		{"warmup", 1, "", "/api/admin/state", false},
		{"warmup", 1, "", "/media/local.mp3", true},
	} {
		t.Run(fmt.Sprintf("%s/%d/%s/%s", tc.kind, tc.count, tc.source, tc.raw), func(t *testing.T) {
			media := make([]Media, tc.count)
			for i := range media {
				media[i] = Media{ID: fmt.Sprintf("m%d", i), Kind: "audio", URL: tc.raw}
				if tc.source != "" {
					media[i].Netease = &NeteaseSource{SongID: tc.source}
				}
			}
			_, err := Open(filepath.Join(t.TempDir(), "state.json"), Config{Settings: Settings{Title: "test"}, Questions: []Question{{ID: "warmup", Kind: tc.kind, Title: "test", Enabled: true, Media: media}}})
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
	for _, raw := range []string{"/api/netease/audio/0", "/api/netease/audio/01", "/api/netease/audio/1/../2", "/api/netease/audio/1#x", "/api/netease/audio/1?x=y"} {
		if ValidURL(raw) {
			t.Fatalf("invalid stable source accepted: %s", raw)
		}
	}
}
