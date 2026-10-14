package party

import "math"

func validPlaybackRate(rate float64) bool {
	return !math.IsNaN(rate) && !math.IsInf(rate, 0) && rate >= 0.5 && rate <= 2
}

func effectivePlaybackRate(rate float64) float64 {
	// Archives and saved sessions created before speed controls omit the field.
	if rate == 0 {
		return 1
	}
	return rate
}

func (p Playback) positionAt(now int64) float64 {
	if p.Status != "playing" {
		return p.Position
	}
	return p.Position + float64(max(int64(0), now-p.UpdatedAt))/1000*effectivePlaybackRate(p.Rate)
}
