package netease

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
)

type ID string

func (id *ID) UnmarshalJSON(raw []byte) error {
	if bytes.Equal(raw, []byte("null")) {
		*id = ""
		return nil
	}
	var value string
	if len(raw) > 0 && raw[0] == '"' {
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
	} else {
		value = string(raw)
	}
	if !validID(value) {
		return errors.New("网易云编号无效")
	}
	*id = ID(value)
	return nil
}

type Error struct{ Kind, Message string }

func (e *Error) Error() string           { return e.Message }
func failure(kind, message string) error { return &Error{kind, message} }

type Status struct {
	Ready    bool   `json:"ready"`
	LoggedIn bool   `json:"loggedIn"`
	UserID   ID     `json:"userId,omitempty"`
	Nickname string `json:"nickname,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
	Message  string `json:"message,omitempty"`
}
type Login struct {
	Task      string `json:"task"`
	State     string `json:"state"`
	QRImage   string `json:"qrImage,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
}
type Playlist struct {
	ID    ID     `json:"id"`
	Name  string `json:"name"`
	Cover string `json:"cover"`
	Count int    `json:"count"`
}
type PlaylistPage struct {
	Playlists  []Playlist `json:"playlists"`
	More       bool       `json:"more"`
	NextOffset int        `json:"nextOffset"`
}
type Track struct {
	ID       ID       `json:"id"`
	Name     string   `json:"name"`
	Artists  []string `json:"artists"`
	Album    string   `json:"album"`
	Cover    string   `json:"cover"`
	Duration float64  `json:"duration"`
	Fee      int      `json:"fee"`
}
type TrackPage struct {
	Title      string  `json:"title"`
	Tracks     []Track `json:"tracks"`
	Total      int     `json:"total"`
	NextOffset int     `json:"nextOffset"`
	More       bool    `json:"more"`
}
type Stream struct {
	URL        string
	ExpiresAt  int64
	generation uint64
}

func validID(id string) bool {
	if len(id) < 1 || len(id) > 19 || id[0] == '0' {
		return false
	}
	return strings.IndexFunc(id, func(r rune) bool { return r < '0' || r > '9' }) == -1
}
