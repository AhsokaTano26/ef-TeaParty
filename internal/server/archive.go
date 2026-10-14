package server

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"ef-teaparty/internal/party"
)

const (
	archiveLimit         int64 = 32 << 30
	archiveFileLimit     int64 = 3 << 30
	archiveStateLimit    int64 = 32 << 20
	archiveManifestLimit int64 = 8 << 20
	archiveEntryLimit          = 10000
	archiveTTL                 = 15 * time.Minute
)

var archiveEntryName = regexp.MustCompile(`^files/[a-zA-Z0-9_-]{1,100}\.[a-zA-Z0-9]{1,8}$`)

type archiveAsset struct {
	URL    string `json:"url"`
	Entry  string `json:"entry,omitempty"`
	Status string `json:"status"`
	Size   int64  `json:"size,omitempty"`
	SHA256 string `json:"sha256,omitempty"`
	Reason string `json:"reason,omitempty"`
}
type archiveManifest struct {
	Format      string         `json:"format"`
	Version     int            `json:"version"`
	SnapshotAt  int64          `json:"snapshotAt"`
	StateSHA256 string         `json:"stateSha256"`
	Assets      []archiveAsset `json:"assets"`
}
type archiveSummary struct {
	Title       string   `json:"title"`
	PageTitle   string   `json:"pageTitle"`
	Questions   int      `json:"questions"`
	Teams       int      `json:"teams"`
	Scores      int      `json:"scores"`
	Draws       int      `json:"draws"`
	LocalFiles  int      `json:"localFiles"`
	TotalBytes  int64    `json:"totalBytes"`
	SnapshotAt  int64    `json:"snapshotAt"`
	External    []string `json:"external"`
	Unavailable []string `json:"unavailable"`
}
type inspectedArchive struct {
	path     string
	session  string
	state    party.State
	manifest archiveManifest
	revision int64
	expires  time.Time
	timer    *time.Timer
}

type archiveContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r archiveContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func archiveReferences(st *party.State, change func(string) string) {
	changeAppearance := func(appearance *party.WarmupAudioAppearance) {
		if appearance == nil {
			return
		}
		if appearance.Cover != "" {
			appearance.Cover = change(appearance.Cover)
		}
		if appearance.Background != "" {
			appearance.Background = change(appearance.Background)
		}
	}
	if st.Config.Settings.Background != "" {
		st.Config.Settings.Background = change(st.Config.Settings.Background)
	}
	for i := range st.Config.Questions {
		q := &st.Config.Questions[i]
		changeAppearance(q.WarmupAudio)
		for j := range q.Media {
			q.Media[j].URL = change(q.Media[j].URL)
			changeAppearance(q.Media[j].WarmupAudio)
		}
		for j := range q.Illustrations {
			q.Illustrations[j].URL = change(q.Illustrations[j].URL)
		}
	}
}
func archiveURLs(st party.State) []string {
	seen := map[string]bool{}
	archiveReferences(&st, func(v string) string { seen[v] = true; return v })
	urls := make([]string, 0, len(seen))
	for v := range seen {
		urls = append(urls, v)
	}
	sort.Strings(urls)
	return urls
}
func archiveExternal(v string) bool {
	u, e := url.Parse(v)
	return e == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}
func archiveExtension(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".webm", ".mov":
		return ext
	}
	return ""
}

// OpenRoot contains resolution within a public media root even if a directory changes.
// Explicit symlink checks additionally prevent bundling unrelated files through links.
func (s *Server) openArchiveAsset(raw string) (*os.File, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.Fragment != "" || path.Clean(u.Path) != u.Path || strings.ContainsAny(u.Path, "\\\x00") {
		return nil, fmt.Errorf("本地素材地址无效")
	}
	base, relative := "", ""
	switch {
	case strings.HasPrefix(u.Path, "/media/"):
		base = s.media
		relative = strings.TrimPrefix(u.Path, "/media/")
	case strings.HasPrefix(u.Path, "/assets/ppt/"):
		base = s.assets
		relative = strings.TrimPrefix(u.Path, "/assets/")
	case strings.HasPrefix(u.Path, "/assets/"):
		base = filepath.Join(s.web, "assets")
		relative = strings.TrimPrefix(u.Path, "/assets/")
	default:
		return nil, fmt.Errorf("素材地址不属于可导出的目录")
	}
	if !filepath.IsLocal(relative) || archiveExtension(relative) == "" {
		return nil, fmt.Errorf("素材文件格式不受支持")
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	parts := strings.Split(relative, "/")
	for i := range parts {
		info, e := root.Lstat(filepath.Join(parts[:i+1]...))
		if e != nil {
			return nil, e
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("素材为符号链接")
		}
	}
	f, err := root.Open(relative)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, fmt.Errorf("素材不是普通文件")
	}
	return f, nil
}
func archiveWriteJSON(zw *zip.Writer, name string, value any) ([]byte, error) {
	b, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return nil, e
	}
	entry, e := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
	if e != nil {
		return nil, e
	}
	_, e = entry.Write(b)
	return b, e
}
func archiveHash(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

func (s *Server) downloadArchive(w http.ResponseWriter, r *http.Request) {
	st := s.store.Snapshot()
	manifest := archiveManifest{Format: "ef-teaparty-activity", Version: 1, SnapshotAt: st.ServerTime, Assets: []archiveAsset{}}
	urls := archiveURLs(st)
	if len(urls) > archiveEntryLimit-2 {
		respond(w, 400, map[string]string{"error": "素材数量超过归档上限（9998 个）"})
		return
	}
	var total int64
	for _, raw := range urls {
		item := archiveAsset{URL: raw, Status: "external"}
		if !archiveExternal(raw) {
			item.Status = "unavailable"
			item.Reason = "本地文件不存在、不可读取、超过 3 GB 或格式不受支持"
			f, e := s.openArchiveAsset(raw)
			if e == nil {
				info, statErr := f.Stat()
				_ = f.Close()
				if statErr == nil && info.Size() <= archiveFileLimit {
					item.Status = "local"
					item.Reason = ""
					item.Size = info.Size()
					u, _ := url.Parse(raw)
					item.Entry = fmt.Sprintf("files/%05d%s", len(manifest.Assets), archiveExtension(u.Path))
					total += info.Size()
				}
			}
		}
		manifest.Assets = append(manifest.Assets, item)
	}
	rawState, err := json.Marshal(st)
	if err != nil || int64(len(rawState)) > archiveStateLimit || total > archiveLimit-archiveStateLimit-archiveManifestLimit {
		respond(w, 400, map[string]string{"error": "活动超过归档大小限制（32 GB）"})
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="teaparty-%s.zip"`, time.Now().Format("20060102-150405")))
	zw := zip.NewWriter(w)
	// Store media without recompression: memory stays bounded for multi-gigabyte video.
	rawState, err = archiveWriteJSON(zw, "state.json", st)
	if err != nil {
		return
	}
	manifest.StateSHA256 = archiveHash(rawState)
	buffer := make([]byte, 128<<10)
	for i := range manifest.Assets {
		item := &manifest.Assets[i]
		if item.Status != "local" {
			continue
		}
		f, e := s.openArchiveAsset(item.URL)
		if e != nil {
			return
		}
		info, e := f.Stat()
		if e != nil || info.Size() != item.Size {
			f.Close()
			return
		}
		entry, e := zw.CreateHeader(&zip.FileHeader{Name: item.Entry, Method: zip.Store})
		if e != nil {
			f.Close()
			return
		}
		hash := sha256.New()
		n, e := io.CopyBuffer(io.MultiWriter(entry, hash), io.LimitReader(archiveContextReader{r.Context(), f}, item.Size+1), buffer)
		_ = f.Close()
		if e != nil || n != item.Size {
			return
		}
		item.SHA256 = hex.EncodeToString(hash.Sum(nil))
	}
	if _, err = archiveWriteJSON(zw, "manifest.json", manifest); err != nil {
		return
	}
	_ = zw.Close()
}

func archiveReadJSON(f *zip.File, limit int64, target any) ([]byte, error) {
	if f == nil || f.UncompressedSize64 > uint64(limit) {
		return nil, fmt.Errorf("归档缺少必要信息或信息过大")
	}
	reader, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	b, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, fmt.Errorf("归档信息或校验和无效")
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	if err = d.Decode(target); err != nil {
		return nil, fmt.Errorf("归档 JSON 无效：%w", err)
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("归档 JSON 含多余内容")
	}
	return b, nil
}

// Bound central-directory allocation before archive/zip constructs its entry slice.
// The archive body lives on disk; metadata must also have an explicit memory bound.
func checkArchiveDirectory(filename string) error {
	f, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if info.Size() < 22 || info.Size() > archiveLimit {
		return fmt.Errorf("归档文件大小无效")
	}
	tail := make([]byte, min(info.Size(), int64(65535+22)))
	if _, err = f.ReadAt(tail, info.Size()-int64(len(tail))); err != nil {
		return err
	}
	offset := bytes.LastIndex(tail, []byte{0x50, 0x4b, 0x05, 0x06})
	if offset < 0 || len(tail)-offset < 22 {
		return fmt.Errorf("ZIP 目录无效")
	}
	end := tail[offset:]
	if len(end) != 22+int(binary.LittleEndian.Uint16(end[20:22])) {
		return fmt.Errorf("ZIP 目录长度无效")
	}
	count := uint64(binary.LittleEndian.Uint16(end[10:12]))
	size := uint64(binary.LittleEndian.Uint32(end[12:16]))
	if count == 0xffff || size == 0xffffffff || binary.LittleEndian.Uint32(end[16:20]) == 0xffffffff {
		position := info.Size() - int64(len(tail)) + int64(offset)
		locator := make([]byte, 20)
		if position < 20 {
			return fmt.Errorf("ZIP64 目录无效")
		}
		if _, err = f.ReadAt(locator, position-20); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(locator[:4]) != 0x07064b50 {
			return fmt.Errorf("ZIP64 目录缺失")
		}
		location := binary.LittleEndian.Uint64(locator[8:16])
		if location > uint64(info.Size()-56) {
			return fmt.Errorf("ZIP64 目录超出范围")
		}
		record := make([]byte, 56)
		if _, err = f.ReadAt(record, int64(location)); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(record[:4]) != 0x06064b50 {
			return fmt.Errorf("ZIP64 目录签名无效")
		}
		count = binary.LittleEndian.Uint64(record[32:40])
		size = binary.LittleEndian.Uint64(record[40:48])
	}
	if count > archiveEntryLimit || size > 16<<20 {
		return fmt.Errorf("归档文件数量或目录信息超出限制")
	}
	return nil
}

func inspectArchiveFile(ctx context.Context, filename string) (party.State, archiveManifest, archiveSummary, error) {
	fail := func(e error) (party.State, archiveManifest, archiveSummary, error) {
		return party.State{}, archiveManifest{}, archiveSummary{}, e
	}
	if err := checkArchiveDirectory(filename); err != nil {
		return fail(err)
	}
	zr, err := zip.OpenReader(filename)
	if err != nil {
		return fail(fmt.Errorf("无法读取 ZIP 归档"))
	}
	defer zr.Close()
	if len(zr.File) > archiveEntryLimit {
		return fail(fmt.Errorf("归档文件数量超出限制"))
	}
	files := map[string]*zip.File{}
	names := map[string]bool{}
	var total uint64
	for _, f := range zr.File {
		n := f.Name
		if n == "" || path.Clean(n) != n || strings.HasPrefix(n, "/") || strings.ContainsAny(n, "\\:\x00") || strings.HasPrefix(n, "../") || n == ".." || !f.Mode().IsRegular() || f.Flags&1 != 0 || names[strings.ToLower(n)] {
			return fail(fmt.Errorf("归档含非法路径、链接或重复文件"))
		}
		if n != "state.json" && n != "manifest.json" && (!archiveEntryName.MatchString(n) || archiveExtension(n) == "") {
			return fail(fmt.Errorf("归档含有未支持的文件"))
		}
		names[strings.ToLower(n)] = true
		files[n] = f
		if f.UncompressedSize64 > uint64(archiveFileLimit) || f.CompressedSize64 > uint64(archiveLimit) || total > uint64(archiveLimit)-f.UncompressedSize64 {
			return fail(fmt.Errorf("归档解压大小超出限制"))
		}
		total += f.UncompressedSize64
		if f.UncompressedSize64 > 1<<20 && (f.CompressedSize64 == 0 || f.UncompressedSize64/f.CompressedSize64 > 1000) {
			return fail(fmt.Errorf("归档压缩比例异常"))
		}
	}
	var manifest archiveManifest
	_, err = archiveReadJSON(files["manifest.json"], archiveManifestLimit, &manifest)
	if err != nil {
		return fail(err)
	}
	if manifest.Format != "ef-teaparty-activity" || manifest.Version != 1 || len(manifest.Assets) > archiveEntryLimit-2 {
		return fail(fmt.Errorf("归档版本不受支持"))
	}
	var st party.State
	raw, err := archiveReadJSON(files["state.json"], archiveStateLimit, &st)
	if err != nil {
		return fail(err)
	}
	if archiveHash(raw) != manifest.StateSHA256 {
		return fail(fmt.Errorf("活动状态校验和不匹配"))
	}
	if st.ServerTime != manifest.SnapshotAt {
		return fail(fmt.Errorf("归档快照时间不匹配"))
	}
	if err = party.ValidateRestore(st, manifest.SnapshotAt); err != nil {
		return fail(err)
	}
	refs := map[string]bool{}
	for _, raw := range archiveURLs(st) {
		refs[raw] = true
	}
	used := map[string]bool{"state.json": true, "manifest.json": true}
	summary := archiveSummary{Title: st.Config.Settings.Title, PageTitle: st.Current().Title, Questions: len(st.Config.Questions), Teams: len(st.Config.Teams), Scores: len(st.Scores), Draws: len(st.Draws), SnapshotAt: manifest.SnapshotAt, External: []string{}, Unavailable: []string{}}
	buffer := make([]byte, 128<<10)
	for _, asset := range manifest.Assets {
		if !refs[asset.URL] {
			return fail(fmt.Errorf("归档素材清单含重复或未知引用"))
		}
		delete(refs, asset.URL)
		switch asset.Status {
		case "external":
			if !archiveExternal(asset.URL) || asset.Entry != "" || asset.Size != 0 || asset.SHA256 != "" {
				return fail(fmt.Errorf("远程素材清单无效"))
			}
			summary.External = append(summary.External, asset.URL)
		case "unavailable":
			if archiveExternal(asset.URL) || asset.Entry != "" || asset.Size != 0 || asset.SHA256 != "" {
				return fail(fmt.Errorf("缺失素材清单无效"))
			}
			summary.Unavailable = append(summary.Unavailable, asset.URL)
		case "local":
			file := files[asset.Entry]
			if archiveExternal(asset.URL) || !strings.HasPrefix(asset.URL, "/") || file == nil || !strings.HasPrefix(asset.Entry, "files/") || used[asset.Entry] || asset.Size < 0 || uint64(asset.Size) != file.UncompressedSize64 || len(asset.SHA256) != 64 {
				return fail(fmt.Errorf("本地素材清单无效"))
			}
			if _, err = hex.DecodeString(asset.SHA256); err != nil {
				return fail(fmt.Errorf("素材校验和格式无效"))
			}
			used[asset.Entry] = true
			reader, e := file.Open()
			if e != nil {
				return fail(e)
			}
			hash := sha256.New()
			n, e := io.CopyBuffer(hash, io.LimitReader(archiveContextReader{ctx, reader}, asset.Size+1), buffer)
			_ = reader.Close()
			if e != nil || n != asset.Size || hex.EncodeToString(hash.Sum(nil)) != asset.SHA256 {
				return fail(fmt.Errorf("素材校验失败：%s", asset.URL))
			}
			summary.LocalFiles++
			summary.TotalBytes += n
		default:
			return fail(fmt.Errorf("未知素材状态"))
		}
	}
	if len(refs) != 0 || len(used) != len(files) {
		return fail(fmt.Errorf("归档素材清单不完整或包含多余文件"))
	}
	return st, manifest, summary, nil
}

func (s *Server) extractArchive(ctx context.Context, item *inspectedArchive) (party.State, string, error) {
	zr, err := zip.OpenReader(item.path)
	if err != nil {
		return party.State{}, "", err
	}
	defer zr.Close()
	if err = os.MkdirAll(s.media, 0700); err != nil {
		return party.State{}, "", err
	}
	directory, err := os.MkdirTemp(s.media, "restored-")
	if err != nil {
		return party.State{}, "", err
	}
	fail := func(e error) (party.State, string, error) { _ = os.RemoveAll(directory); return party.State{}, "", e }
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	refs := map[string]string{}
	buffer := make([]byte, 128<<10)
	for index, asset := range item.manifest.Assets {
		if asset.Status == "external" {
			refs[asset.URL] = asset.URL
			continue
		}
		name := path.Base(asset.Entry)
		if asset.Status == "unavailable" {
			name = fmt.Sprintf("unavailable-%05d", index)
			refs[asset.URL] = "/media/" + filepath.Base(directory) + "/" + name
			continue
		}
		file := files[asset.Entry]
		if file == nil {
			return fail(fmt.Errorf("归档素材已失效"))
		}
		reader, e := file.Open()
		if e != nil {
			return fail(e)
		}
		output, e := os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			reader.Close()
			return fail(e)
		}
		hash := sha256.New()
		n, e := io.CopyBuffer(io.MultiWriter(output, hash), io.LimitReader(archiveContextReader{ctx, reader}, asset.Size+1), buffer)
		_ = reader.Close()
		if e == nil {
			e = output.Sync()
		}
		ce := output.Close()
		if e == nil {
			e = ce
		}
		if e != nil || n != asset.Size || hex.EncodeToString(hash.Sum(nil)) != asset.SHA256 {
			return fail(fmt.Errorf("恢复素材校验失败"))
		}
		refs[asset.URL] = "/media/" + filepath.Base(directory) + "/" + name
	}
	// The staged state belongs exclusively to this consumed token.
	st := item.state
	archiveReferences(&st, func(raw string) string { return refs[raw] })
	return st, directory, nil
}

func (s *Server) registerArchiveRoutes(mux *http.ServeMux) {
	var mu sync.Mutex
	staged := map[string]*inspectedArchive{}
	uploading := make(chan struct{}, 1)
	remove := func(token string) {
		mu.Lock()
		item := staged[token]
		delete(staged, token)
		mu.Unlock()
		if item != nil {
			_ = os.Remove(item.path)
		}
	}
	mux.Handle("GET /api/admin/archive", s.auth(http.HandlerFunc(s.downloadArchive)))
	mux.Handle("POST /api/admin/archive/inspect", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case uploading <- struct{}{}:
			defer func() { <-uploading }()
		default:
			respond(w, 429, map[string]string{"error": "已有归档正在预检，请稍后再试"})
			return
		}
		mu.Lock()
		full := len(staged) >= 2
		mu.Unlock()
		if full {
			respond(w, 429, map[string]string{"error": "待恢复归档数量已满，请取消先前预检或等待 15 分钟"})
			return
		}
		if r.ContentLength > archiveLimit+1<<20 {
			respond(w, 413, map[string]string{"error": "ZIP 归档最大 32 GB"})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, archiveLimit+1<<20)
		form, err := r.MultipartReader()
		if err != nil {
			respond(w, 400, map[string]string{"error": "请上传 ZIP 归档"})
			return
		}
		part, err := form.NextPart()
		if err != nil || part.FormName() != "file" || part.FileName() == "" {
			respond(w, 400, map[string]string{"error": "请选择归档文件"})
			return
		}
		file, err := os.CreateTemp("", "teaparty-archive-*.zip")
		if err != nil {
			respond(w, 500, map[string]string{"error": "无法创建临时归档"})
			return
		}
		filename := file.Name()
		retained := false
		defer func() {
			if !retained {
				_ = os.Remove(filename)
			}
		}()
		n, err := io.CopyBuffer(file, io.LimitReader(archiveContextReader{r.Context(), part}, archiveLimit+1), make([]byte, 128<<10))
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		var tooLarge *http.MaxBytesError
		if n > archiveLimit || errors.As(err, &tooLarge) {
			respond(w, 413, map[string]string{"error": "ZIP 归档最大 32 GB"})
			return
		}
		if err != nil {
			respond(w, 400, map[string]string{"error": "归档上传中断"})
			return
		}
		if _, err = form.NextPart(); err != io.EOF {
			respond(w, 400, map[string]string{"error": "一次只能上传一个归档文件"})
			return
		}
		st, manifest, summary, err := inspectArchiveFile(r.Context(), filename)
		if err != nil {
			respond(w, 400, map[string]string{"error": err.Error()})
			return
		}
		if err = r.Context().Err(); err != nil {
			return
		}
		cookie, _ := r.Cookie("party_session")
		token := party.NewID() + party.NewID()
		expires := time.Now().Add(archiveTTL)
		item := &inspectedArchive{path: filename, session: cookie.Value, state: st, manifest: manifest, revision: s.store.Snapshot().Revision, expires: expires}
		mu.Lock()
		staged[token] = item
		item.timer = time.AfterFunc(archiveTTL, func() { remove(token) })
		mu.Unlock()
		retained = true
		respond(w, 200, map[string]any{"token": token, "revision": item.revision, "expiresAt": expires.UnixMilli(), "summary": summary})
	})))
	mux.Handle("DELETE /api/admin/archive/inspect/{token}", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, _ := r.Cookie("party_session")
		token := r.PathValue("token")
		mu.Lock()
		item := staged[token]
		if item == nil || item.session != cookie.Value {
			mu.Unlock()
			respond(w, 404, map[string]string{"error": "预检已失效"})
			return
		}
		delete(staged, token)
		item.timer.Stop()
		mu.Unlock()
		_ = os.Remove(item.path)
		respond(w, 200, map[string]bool{"ok": true})
	})))
	mux.Handle("POST /api/admin/archive/restore", s.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v struct {
			Token    string `json:"token"`
			Revision int64  `json:"revision"`
		}
		if err := decode(w, r, &v); err != nil {
			respond(w, 400, map[string]string{"error": err.Error()})
			return
		}
		cookie, _ := r.Cookie("party_session")
		mu.Lock()
		item := staged[v.Token]
		if item == nil || item.session != cookie.Value || time.Now().After(item.expires) {
			mu.Unlock()
			respond(w, 404, map[string]string{"error": "预检已失效，请重新上传归档"})
			return
		}
		if v.Revision != item.revision {
			mu.Unlock()
			respond(w, 409, map[string]string{"error": "预检版本不匹配，请重新预检"})
			return
		}
		delete(staged, v.Token)
		item.timer.Stop()
		mu.Unlock()
		defer os.Remove(item.path)
		if s.store.Snapshot().Revision != item.revision {
			respond(w, 409, map[string]string{"error": "活动已在预检后发生变化，请重新预检归档后再恢复"})
			return
		}
		st, directory, err := s.extractArchive(r.Context(), item)
		if err != nil {
			respond(w, 400, map[string]string{"error": "无法恢复归档素材：" + err.Error()})
			return
		}
		if err = r.Context().Err(); err != nil {
			_ = os.RemoveAll(directory)
			return
		}
		if err = s.store.Restore(st, item.manifest.SnapshotAt, item.revision); err != nil {
			_ = os.RemoveAll(directory)
			respond(w, 409, map[string]string{"error": err.Error()})
			return
		}
		respond(w, 200, s.store.Snapshot())
	})))
}
