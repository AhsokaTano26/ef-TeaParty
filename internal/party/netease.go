package party

import (
	"regexp"
	"strings"
)

type NeteaseSource struct {
	SongID string `json:"songId"`
}

var neteaseID = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

func ValidNeteaseID(id string) bool { return neteaseID.MatchString(id) }

// NeteaseSongID recognizes only stable, local audio references, never a general API path.
func NeteaseSongID(raw string) string {
	const prefix = "/api/netease/audio/"
	if !strings.HasPrefix(raw, prefix) {
		return ""
	}
	id := strings.TrimPrefix(raw, prefix)
	if !ValidNeteaseID(id) {
		return ""
	}
	return id
}
