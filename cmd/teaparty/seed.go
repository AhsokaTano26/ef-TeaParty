package main

import (
	"ef-teaparty/internal/party"
	"encoding/json"
	"fmt"
	"os"
)

// Keep a locally imported question bank optional so a source-only checkout runs
// without bundling the host's questions, answers or activity data.
func loadSeed(path string) (party.Config, error) {
	explicit := path != ""
	if !explicit {
		path = "assets/seed.json"
	}
	b, err := os.ReadFile(path)
	if !explicit && os.IsNotExist(err) {
		return blankConfig(), nil
	}
	if err != nil {
		return party.Config{}, fmt.Errorf("读取首次启动题库 %q：%w", path, err)
	}
	var cfg party.Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return party.Config{}, fmt.Errorf("解析首次启动题库 %q：%w", path, err)
	}
	return cfg, nil
}

func blankConfig() party.Config {
	return party.Config{
		Settings: party.Settings{
			Title: "冬日茶话会", Subtitle: "重庆大学动漫社偶研部", ShowScores: true,
		},
		Teams: []party.Team{
			{ID: "a", Name: "A组", Color: "#ce7180"},
			{ID: "b", Name: "B组", Color: "#347cc1"},
			{ID: "c", Name: "C组", Color: "#3e9a73"},
		},
		Questions: []party.Question{
			{ID: "warmup", Kind: "warmup", Section: "暖场", Title: "入场暖场", Body: "茶话会即将开始，欢迎入座。", Enabled: true},
			{ID: "welcome", Kind: "intro", Section: "开场", Title: "冬日茶话会", Body: "欢迎来到我们的冬日聚会", Enabled: true},
			{ID: "opening-logos", Kind: "intro", Presentation: "logos", Section: "开场", Title: "热爱，在此集结", Body: "重庆大学动漫社 · 偶像研究部", Enabled: true},
			{ID: "awards", Kind: "score", Section: "颁奖", Title: "把热爱留在这个冬天", Body: "感谢每一位到场的同学。", Enabled: true},
		},
		Lottery: party.LotteryConfig{Mode: "names", Names: []string{}, Min: 1, Max: 100, Count: 1, NoRepeat: true},
	}
}
