package party

type Settings struct {
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle"`
	Background string `json:"background"`
	ShowScores bool   `json:"showScores"`
}
type Team struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}
type Media struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name,omitempty"`
	Kind        string                 `json:"kind"`
	URL         string                 `json:"url"`
	Start       float64                `json:"start"`
	End         float64                `json:"end"`
	AnswerOnly  bool                   `json:"answerOnly"`
	WarmupAudio *WarmupAudioAppearance `json:"warmupAudio,omitempty"`
	Netease     *NeteaseSource         `json:"netease,omitempty"`
}
type Illustration struct {
	ID      string  `json:"id"`
	URL     string  `json:"url"`
	Name    string  `json:"name"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Width   float64 `json:"width"`
	Layer   string  `json:"layer"`
	Flipped bool    `json:"flipped"`
	Locked  bool    `json:"locked,omitempty"`
}
type WarmupAudioAppearance struct {
	Cover      string `json:"cover"`
	Background string `json:"background"`
}
type Question struct {
	ID                string                 `json:"id"`
	Kind              string                 `json:"kind"`
	Section           string                 `json:"section"`
	Title             string                 `json:"title"`
	Body              string                 `json:"body"`
	Options           []string               `json:"options"`
	Answer            string                 `json:"answer"`
	Explanation       string                 `json:"explanation"`
	Points            int                    `json:"points"`
	WrongPoints       int                    `json:"wrongPoints"`
	PlayerPoints      int                    `json:"playerPoints"`
	PlayerWrongPoints int                    `json:"playerWrongPoints"`
	Duration          int                    `json:"duration"`
	Enabled           bool                   `json:"enabled"`
	Media             []Media                `json:"media"`
	Source            string                 `json:"source"`
	Review            string                 `json:"review"`
	Presentation      string                 `json:"presentation,omitempty"`
	Illustrations     []Illustration         `json:"illustrations,omitempty"`
	WarmupAudio       *WarmupAudioAppearance `json:"warmupAudio,omitempty"`
	WelcomeShowScores *bool                  `json:"welcomeShowScores,omitempty"`
	WelcomeShowTimer  *bool                  `json:"welcomeShowTimer,omitempty"`
}
type LotteryConfig struct {
	Mode     string   `json:"mode"`
	Names    []string `json:"names"`
	Min      int      `json:"min"`
	Max      int      `json:"max"`
	Count    int      `json:"count"`
	NoRepeat bool     `json:"noRepeat"`
}
type Config struct {
	Settings  Settings      `json:"settings"`
	Teams     []Team        `json:"teams"`
	Questions []Question    `json:"questions"`
	Lottery   LotteryConfig `json:"lottery"`
}
type Playback struct {
	Status    string  `json:"status"`
	Position  float64 `json:"position"`
	Rate      float64 `json:"rate"`
	UpdatedAt int64   `json:"updatedAt"`
	Index     int     `json:"index"`
	Seq       int64   `json:"seq"`
}
type Timer struct {
	Remaining int   `json:"remaining"`
	Deadline  int64 `json:"deadline"`
	Duration  int   `json:"duration,omitempty"`
}
type Session struct {
	CurrentID             string   `json:"currentId"`
	Revealed              bool     `json:"revealed"`
	Media                 Playback `json:"media"`
	Timer                 Timer    `json:"timer"`
	LotteryVisible        bool     `json:"lotteryVisible"`
	LotteryIntro          bool     `json:"lotteryIntro"`
	VideoFullscreen       bool     `json:"videoFullscreen"`
	PresentationStartedAt int64    `json:"presentationStartedAt,omitempty"`
}
type Score struct {
	ID          string `json:"id"`
	TeamID      string `json:"teamId"`
	QuestionID  string `json:"questionId,omitempty"`
	Correct     bool   `json:"correct"`
	Delta       int    `json:"delta"`
	PlayerDelta int    `json:"playerDelta"`
	Player      string `json:"player"`
	Note        string `json:"note"`
	At          int64  `json:"at"`
}
type Draw struct {
	ID       string   `json:"id"`
	Mode     string   `json:"mode"`
	Values   []string `json:"values"`
	At       int64    `json:"at"`
	RevealAt int64    `json:"revealAt,omitempty"`
}
type LotteryView struct {
	Phase         string   `json:"phase"`
	Mode          string   `json:"mode"`
	Count         int      `json:"count"`
	Min           int      `json:"min"`
	Max           int      `json:"max"`
	Candidates    []string `json:"candidates"`
	Used          []string `json:"used"`
	DrawID        string   `json:"drawId"`
	StartedAt     int64    `json:"startedAt"`
	RevealAt      int64    `json:"revealAt"`
	LandingValues []string `json:"landingValues,omitempty"`
}
type State struct {
	FormatVersion  int     `json:"formatVersion"`
	Config         Config  `json:"config"`
	Session        Session `json:"session"`
	Scores         []Score `json:"scores"`
	Draws          []Draw  `json:"draws"`
	Revision       int64   `json:"revision"`
	ConfigRevision int64   `json:"configRevision"`
	ServerTime     int64   `json:"serverTime,omitempty"`
}
type Action struct {
	Op          string  `json:"op"`
	ID          string  `json:"id"`
	TeamID      string  `json:"teamId"`
	Correct     bool    `json:"correct"`
	Delta       int     `json:"delta"`
	PlayerDelta int     `json:"playerDelta"`
	Player      string  `json:"player"`
	Note        string  `json:"note"`
	Position    float64 `json:"position"`
	Rate        float64 `json:"rate"`
	Index       int     `json:"index"`
	Seconds     int     `json:"seconds"`
	Seq         *int64  `json:"seq,omitempty"`
	Enabled     bool    `json:"enabled"`
	Delay       int     `json:"delay"`
}
type PublicTeam struct {
	Team
	Score int `json:"score"`
}
type PublicState struct {
	Preload    []PreloadAsset `json:"preload,omitempty"`
	Settings   Settings       `json:"settings"`
	Teams      []PublicTeam   `json:"teams"`
	Question   *Question      `json:"question"`
	Session    Session        `json:"session"`
	Draw       *Draw          `json:"draw"`
	Lottery    *LotteryView   `json:"lottery"`
	Page       int            `json:"page"`
	Total      int            `json:"total"`
	Revision   int64          `json:"revision"`
	ServerTime int64          `json:"serverTime"`
}

func (s State) TeamScore(id string) int {
	n := 0
	for _, v := range s.Scores {
		if v.TeamID == id {
			n += v.Delta
		}
	}
	return n
}
func (s State) Current() *Question {
	for i := range s.Config.Questions {
		if s.Config.Questions[i].ID == s.Session.CurrentID {
			return &s.Config.Questions[i]
		}
	}
	return nil
}
