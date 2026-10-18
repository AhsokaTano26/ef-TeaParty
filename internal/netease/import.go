package netease

import (
	"context"
	"strings"
	"unicode/utf8"
)

const pageSize = 50

type rawSong struct {
	ID       ID      `json:"id"`
	Name     string  `json:"name"`
	Duration float64 `json:"dt"`
	Artists  []struct {
		Name string `json:"name"`
	} `json:"ar"`
	Album struct {
		Name  string `json:"name"`
		Cover string `json:"picUrl"`
	} `json:"al"`
	Fee int `json:"fee"`
}

func trimBytes(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
func (s *Service) Import(ctx context.Context, input string, offset int) (TrackPage, error) {
	page := TrackPage{Tracks: []Track{}}
	if offset < 0 || offset > 100000 {
		return page, failure("invalid", "歌单分页位置无效")
	}
	link, err := ParseLink(input)
	if err != nil {
		return page, err
	}
	link, err = expandLink(ctx, link)
	if err != nil {
		return page, err
	}
	cookie, _ := s.credential()
	ids := []string{link.ID}
	page.Total = 1
	if link.Kind == "playlist" {
		var response struct {
			Playlist struct {
				Name     string `json:"name"`
				TrackIDs []struct {
					ID ID `json:"id"`
				} `json:"trackIds"`
			} `json:"playlist"`
		}
		if err = s.call(ctx, "playlist_detail", cookie, map[string]any{"id": link.ID}, &response); err != nil {
			return page, err
		}
		page.Title = trimBytes(response.Playlist.Name, 600)
		page.Total = len(response.Playlist.TrackIDs)
		if page.Total > 100000 {
			return page, failure("invalid", "歌单歌曲过多")
		}
		ids = []string{}
		for _, item := range response.Playlist.TrackIDs {
			if validID(string(item.ID)) {
				ids = append(ids, string(item.ID))
			}
		}
		page.Total = len(ids)
	}
	start := min(offset, len(ids))
	end := min(start+pageSize, len(ids))
	page.NextOffset = end
	page.More = end < len(ids)
	if start == end {
		return page, nil
	}
	var songs struct {
		Songs []rawSong `json:"songs"`
	}
	if err = s.call(ctx, "song_detail", cookie, map[string]any{"ids": strings.Join(ids[start:end], ",")}, &songs); err != nil {
		return page, err
	}
	byID := map[string]rawSong{}
	for _, song := range songs.Songs {
		byID[string(song.ID)] = song
	}
	for _, id := range ids[start:end] {
		song, ok := byID[id]
		if !ok {
			continue
		}
		track := Track{ID: song.ID, Name: trimBytes(song.Name, 300), Artists: []string{}, Album: trimBytes(song.Album.Name, 300), Cover: song.Album.Cover, Duration: song.Duration / 1000, Fee: song.Fee}
		for _, artist := range song.Artists {
			if len(track.Artists) < 10 {
				track.Artists = append(track.Artists, trimBytes(artist.Name, 100))
			}
		}
		page.Tracks = append(page.Tracks, track)
	}
	if link.Kind == "song" && len(page.Tracks) > 0 {
		page.Title = page.Tracks[0].Name
	}
	if len(page.Tracks) == 0 {
		return page, failure("unavailable", "未能读取歌曲，可能需要登录或链接已失效")
	}
	return page, nil
}
func (s *Service) Playlists(ctx context.Context, offset int) (PlaylistPage, error) {
	page := PlaylistPage{Playlists: []Playlist{}}
	if offset < 0 || offset > 100000 {
		return page, failure("invalid", "歌单分页位置无效")
	}
	cookie, _ := s.credential()
	if cookie == "" {
		return page, failure("login", "请先扫码登录网易云")
	}
	profile, err := s.profile(ctx, cookie)
	if err != nil {
		return page, err
	}
	var response struct {
		More      bool `json:"more"`
		Playlists []struct {
			ID    ID     `json:"id"`
			Name  string `json:"name"`
			Cover string `json:"coverImgUrl"`
			Count int    `json:"trackCount"`
		} `json:"playlist"`
	}
	if err = s.call(ctx, "user_playlist", cookie, map[string]any{"uid": string(profile.UserID), "limit": pageSize, "offset": offset}, &response); err != nil {
		return page, err
	}
	for _, p := range response.Playlists {
		page.Playlists = append(page.Playlists, Playlist{ID: p.ID, Name: trimBytes(p.Name, 600), Cover: p.Cover, Count: p.Count})
	}
	page.More = response.More
	page.NextOffset = offset + len(page.Playlists)
	return page, nil
}
