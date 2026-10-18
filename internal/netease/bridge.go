package netease

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type Caller interface {
	Call(context.Context, string, any, any) error
	Ready() error
	Close() error
}

type UpstreamError struct {
	Message string
	Code    int
}

func (e *UpstreamError) Error() string { return e.Message }

type reply struct {
	ID     uint64          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
	Code   int             `json:"code"`
}
type bridgeProcess struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	write   sync.Mutex
	pending map[uint64]chan reply
}
type Bridge struct {
	script  string
	mu      sync.Mutex
	process *bridgeProcess
	next    uint64
	closed  bool
}

func NewBridge(script string) *Bridge { return &Bridge{script: script} }
func (b *Bridge) Ready() error {
	if _, err := exec.LookPath("node"); err != nil {
		return errors.New("网易云组件需要 Node.js 22.18+，安装后重启服务")
	}
	if st, err := os.Stat(b.script); err != nil || !st.Mode().IsRegular() {
		return errors.New("网易云组件未安装，请在项目目录执行 make install")
	}
	return nil
}
func (b *Bridge) startLocked() (*bridgeProcess, error) {
	if b.closed {
		return nil, errors.New("网易云组件已关闭")
	}
	if b.process != nil {
		return b.process, nil
	}
	if err := b.Ready(); err != nil {
		return nil, err
	}
	script, err := filepath.Abs(b.script)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command("node", script)
	cmd.Dir = filepath.Dir(script)
	cmd.Stderr = io.Discard
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		return nil, errors.New("无法启动网易云组件")
	}
	p := &bridgeProcess{cmd: cmd, input: input, pending: map[uint64]chan reply{}}
	b.process = p
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), 8<<20)
		for scanner.Scan() {
			var response reply
			if json.Unmarshal(scanner.Bytes(), &response) != nil {
				continue
			}
			b.mu.Lock()
			ch := p.pending[response.ID]
			delete(p.pending, response.ID)
			b.mu.Unlock()
			if ch != nil {
				ch <- response
			}
		}
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		input.Close()
		b.mu.Lock()
		if b.process == p {
			b.process = nil
		}
		for id, ch := range p.pending {
			ch <- reply{Error: "网易云组件不可用，请执行 make install 后重试"}
			delete(p.pending, id)
		}
		b.mu.Unlock()
	}()
	return p, nil
}
func (b *Bridge) Call(ctx context.Context, method string, params any, result any) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	p, err := b.startLocked()
	if err != nil {
		b.mu.Unlock()
		return err
	}
	if len(p.pending) >= 16 {
		b.mu.Unlock()
		return errors.New("网易云请求过多，请稍后重试")
	}
	b.next++
	id := b.next
	ch := make(chan reply, 1)
	p.pending[id] = ch
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(p.pending, id); b.mu.Unlock() }()
	body, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil {
		return err
	}
	if len(body) > 1<<20 {
		return errors.New("网易云请求过大")
	}
	p.write.Lock()
	_, err = p.input.Write(append(body, '\n'))
	p.write.Unlock()
	if err != nil {
		_ = p.cmd.Process.Kill()
		return errors.New("网易云组件连接已中断，请重试")
	}
	select {
	case <-ctx.Done():
		return fmt.Errorf("网易云请求取消或超时：%w", ctx.Err())
	case response := <-ch:
		if response.Error != "" {
			return &UpstreamError{Message: response.Error, Code: response.Code}
		}
		if result == nil {
			return nil
		}
		if err := json.Unmarshal(response.Result, result); err != nil {
			return errors.New("网易云响应格式无效")
		}
		return nil
	}
}
func (b *Bridge) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	if b.process != nil {
		b.process.input.Close()
		return b.process.cmd.Process.Kill()
	}
	return nil
}
