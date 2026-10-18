package netease

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type accountProfile struct {
	UserID   ID     `json:"userId"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatarUrl"`
}
type account struct {
	Cookie  string         `json:"cookie"`
	Profile accountProfile `json:"profile"`
}
type loginTask struct {
	Login
	owner, key string
	generation uint64
	checking   bool
}

func (s *Service) loadAccount() error {
	file, err := os.Open(filepath.Join(s.dir, "account.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() > 65536 {
		return errors.New("账号存档无效")
	}
	return json.NewDecoder(file).Decode(&s.account)
}
func (s *Service) saveAccountLocked(a account) error {
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(s.dir, 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, "account-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(raw); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(s.dir, "account.json"))
}
func (s *Service) profile(ctx context.Context, cookie string) (accountProfile, error) {
	var v struct {
		Data struct {
			Code    int             `json:"code"`
			Profile *accountProfile `json:"profile"`
		} `json:"data"`
	}
	if err := s.call(ctx, "login_status", cookie, nil, &v); err != nil {
		return accountProfile{}, err
	}
	if v.Data.Profile == nil || !validID(string(v.Data.Profile.UserID)) {
		if v.Data.Code == 200 || v.Data.Code == 301 {
			s.expire(cookie)
		}
		return accountProfile{}, failure("login", "网易云登录已失效，请重新扫码")
	}
	return *v.Data.Profile, nil
}
func (s *Service) expire(cookie string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cookie == "" || cookie != s.account.Cookie {
		return
	}
	// If removal fails, preserve the failure for the next explicit logout instead
	// of pretending that the on-disk credential was removed.
	if err := os.Remove(filepath.Join(s.dir, "account.json")); err != nil && !os.IsNotExist(err) {
		s.loadError = err
	}
	s.account = account{}
	s.generation++
	s.tasks = map[string]*loginTask{}
	s.streams = map[string]Stream{}
	s.cancelFlightsLocked()
}
func (s *Service) StartLogin(ctx context.Context, owner string) (Login, error) {
	if owner == "" {
		return Login{}, failure("auth", "请先登录主持后台")
	}
	s.mu.Lock()
	s.generation++
	generation := s.generation
	s.tasks = map[string]*loginTask{}
	s.streams = map[string]Stream{}
	s.cancelFlightsLocked()
	s.mu.Unlock()
	var key struct {
		Data struct {
			Unikey string `json:"unikey"`
		} `json:"data"`
	}
	if err := s.call(ctx, "login_qr_key", "", nil, &key); err != nil {
		return Login{}, err
	}
	if key.Data.Unikey == "" || len(key.Data.Unikey) > 512 {
		return Login{}, failure("upstream", "网易云未返回有效二维码，请重试")
	}
	var qr struct {
		Data struct {
			Image string `json:"qrimg"`
		} `json:"data"`
	}
	if err := s.call(ctx, "login_qr_create", "", map[string]any{"key": key.Data.Unikey, "qrimg": true, "platform": "pc"}, &qr); err != nil {
		return Login{}, err
	}
	if !strings.HasPrefix(qr.Data.Image, "data:image/png;base64,") || len(qr.Data.Image) > 1<<20 {
		return Login{}, failure("upstream", "网易云二维码无效，请重试")
	}
	nonce := make([]byte, 24)
	if _, err := rand.Read(nonce); err != nil {
		return Login{}, err
	}
	login := Login{Task: hex.EncodeToString(nonce), State: "waiting", QRImage: qr.Data.Image, ExpiresAt: s.now().Add(3 * time.Minute).UnixMilli()}
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return Login{}, failure("canceled", "二维码任务已取消")
	}
	s.tasks[login.Task] = &loginTask{Login: login, owner: owner, key: key.Data.Unikey, generation: generation}
	return login, nil
}
func (s *Service) CheckLogin(ctx context.Context, owner, id string) (Login, error) {
	s.mu.Lock()
	task := s.tasks[id]
	if task == nil || task.owner != owner || task.generation != s.generation {
		s.mu.Unlock()
		return Login{}, failure("canceled", "二维码任务已失效，请重新生成")
	}
	if s.now().UnixMilli() >= task.ExpiresAt {
		task.State = "expired"
		result := task.Login
		s.mu.Unlock()
		return result, nil
	}
	if task.checking || task.State == "authorized" || task.State == "expired" {
		result := task.Login
		s.mu.Unlock()
		return result, nil
	}
	task.checking = true
	key := task.key
	s.mu.Unlock()
	defer func() { s.mu.Lock(); task.checking = false; s.mu.Unlock() }()
	var response struct {
		Code   int    `json:"code"`
		Cookie string `json:"cookie"`
	}
	if err := s.call(ctx, "login_qr_check", "", map[string]any{"key": key}, &response); err != nil {
		return Login{}, err
	}
	var saved account
	if response.Code == 803 {
		saved.Cookie = normalizeCookie(response.Cookie)
		if saved.Cookie == "" {
			return Login{}, failure("upstream", "网易云未返回有效登录凭据，请重新扫码")
		}
		var err error
		saved.Profile, err = s.profile(ctx, saved.Cookie)
		if err != nil {
			return Login{}, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tasks[id] != task || task.generation != s.generation || s.now().UnixMilli() >= task.ExpiresAt {
		return Login{}, failure("canceled", "二维码任务已取消或过期")
	}
	switch response.Code {
	case 800:
		task.State = "expired"
	case 801:
		task.State = "waiting"
	case 802:
		task.State = "scanned"
	case 803:
		if err := s.saveAccountLocked(saved); err != nil {
			return Login{}, failure("storage", "无法保存网易云登录信息，请检查数据目录权限")
		}
		s.account = saved
		s.generation++
		task.generation = s.generation
		s.loadError = nil
		s.streams = map[string]Stream{}
		s.cancelFlightsLocked()
		task.State = "authorized"
	default:
		return Login{}, failure("upstream", "网易云登录状态异常，请刷新二维码")
	}
	result := task.Login
	if result.State == "authorized" || result.State == "expired" {
		result.QRImage = ""
	}
	return result, nil
}
func normalizeCookie(raw string) string {
	if len(raw) > 65536 {
		return ""
	}
	values := []string{}
	hasAccount := false
	for _, part := range strings.Split(raw, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || strings.ContainsAny(value, "\r\n") {
			continue
		}
		switch name {
		case "MUSIC_U", "__csrf", "NMTID", "MUSIC_A":
			if name == "MUSIC_U" && value != "" {
				hasAccount = true
			}
			values = append(values, name+"="+value)
		}
	}
	if !hasAccount {
		return ""
	}
	return strings.Join(values, "; ")
}
func (s *Service) CancelLogin(owner, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task := s.tasks[id]; task != nil && task.owner == owner {
		delete(s.tasks, id)
	}
}
func (s *Service) CancelOwner(owner string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, task := range s.tasks {
		if task.owner == owner {
			delete(s.tasks, id)
		}
	}
}
func (s *Service) Logout() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(filepath.Join(s.dir, "account.json")); err != nil && !os.IsNotExist(err) {
		return failure("storage", "无法清除网易云登录信息，请检查数据目录权限")
	}
	s.account = account{}
	s.loadError = nil
	s.generation++
	s.tasks = map[string]*loginTask{}
	s.streams = map[string]Stream{}
	s.cancelFlightsLocked()
	return nil
}
