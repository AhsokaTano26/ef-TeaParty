package party

import "slices"

func clonePointer[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func cloneMedia(m Media) Media {
	m.WarmupAudio = clonePointer(m.WarmupAudio)
	m.Netease = clonePointer(m.Netease)
	return m
}

func cloneQuestion(q Question) Question {
	q.Options = slices.Clone(q.Options)
	q.Media = slices.Clone(q.Media)
	for i := range q.Media {
		q.Media[i] = cloneMedia(q.Media[i])
	}
	q.Illustrations = slices.Clone(q.Illustrations)
	q.WarmupAudio = clonePointer(q.WarmupAudio)
	q.WelcomeShowScores = clonePointer(q.WelcomeShowScores)
	q.WelcomeShowTimer = clonePointer(q.WelcomeShowTimer)
	return q
}

func cloneConfig(c Config) Config {
	c.Teams = slices.Clone(c.Teams)
	c.Questions = slices.Clone(c.Questions)
	for i := range c.Questions {
		c.Questions[i] = cloneQuestion(c.Questions[i])
	}
	c.Lottery.Names = slices.Clone(c.Lottery.Names)
	return c
}

func clone(s State) State {
	s.Config = cloneConfig(s.Config)
	s.Scores = slices.Clone(s.Scores)
	s.Draws = slices.Clone(s.Draws)
	for i := range s.Draws {
		s.Draws[i].Values = slices.Clone(s.Draws[i].Values)
	}
	return s
}
