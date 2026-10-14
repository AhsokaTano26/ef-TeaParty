package party

// PreloadAsset deliberately carries no question or answer content.
type PreloadAsset struct {
	URL  string `json:"url"`
	Kind string `json:"kind"`
}

const preloadImageLimit = 4

func warmupAudioAppearance(question *Question, media Media) WarmupAudioAppearance {
	appearance := WarmupAudioAppearance{
		Cover:      "/assets/warmup/default-cd.svg",
		Background: "/assets/warmup/default-background.svg",
	}
	for _, override := range []*WarmupAudioAppearance{question.WarmupAudio, media.WarmupAudio} {
		if override == nil {
			continue
		}
		if override.Cover != "" {
			appearance.Cover = override.Cover
		}
		if override.Background != "" {
			appearance.Background = override.Background
		}
	}
	return appearance
}

func nextPreloadPlan(st State) []PreloadAsset {
	current := -1
	for i, q := range st.Config.Questions {
		if q.ID == st.Session.CurrentID {
			current = i
			break
		}
	}
	if current < 0 {
		return nil
	}
	var next *Question
	for i := current + 1; i < len(st.Config.Questions); i++ {
		if st.Config.Questions[i].Enabled {
			next = &st.Config.Questions[i]
			break
		}
	}
	if next == nil {
		return nil
	}
	plan := []PreloadAsset{}
	seen := map[string]bool{}
	images, av := 0, false
	add := func(url, kind string) {
		if url == "" || seen[url] || !ValidURL(url) {
			return
		}
		if kind == "image" {
			if images >= preloadImageLimit {
				return
			}
			images++
		} else if kind == "audio" || kind == "video" {
			if av {
				return
			}
			av = true
		} else {
			return
		}
		seen[url] = true
		plan = append(plan, PreloadAsset{URL: url, Kind: kind})
	}
	add(st.Config.Settings.Background, "image")
	if next.Kind == "intro" {
		for _, art := range next.Illustrations {
			add(art.URL, "image")
		}
	}
	// These presentations do not render ordinary question media.
	if next.ID == "welcome" || next.Kind == "score" || (next.Kind == "intro" && next.Presentation == "logos") {
		return plan
	}
	if next.Kind == "warmup" {
		// Only the first public AV is selected on entry. Artwork belonging to
		// later or answer-only songs must not be requested before that song.
		for _, media := range next.Media {
			if media.AnswerOnly || (media.Kind != "audio" && media.Kind != "video") {
				continue
			}
			if media.Kind == "audio" {
				appearance := warmupAudioAppearance(next, media)
				add(appearance.Cover, "image")
				add(appearance.Background, "image")
			}
			add(media.URL, media.Kind)
			break
		}
		return plan
	}
	for _, media := range next.Media {
		if media.AnswerOnly {
			continue
		}
		add(media.URL, media.Kind)
	}
	return plan
}
