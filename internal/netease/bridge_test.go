package netease

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBridgeCorrelationCancellationAndRestart(t *testing.T) {
	script := filepath.Join(t.TempDir(), "fixture.cjs")
	err := os.WriteFile(script, []byte(`const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',l=>{const q=JSON.parse(l);if(q.method==='exit')process.exit(1);else setTimeout(()=>process.stdout.write(JSON.stringify({id:q.id,result:{value:q.params.value}})+'\n'),q.params.delay||0)});`), 0600)
	if err != nil {
		t.Fatal(err)
	}
	b := NewBridge(script)
	defer b.Close()
	if err := b.Ready(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	var result struct {
		Value string `json:"value"`
	}
	if err := b.Call(ctx, "delay", map[string]any{"delay": 100, "value": "old"}, &result); err == nil {
		t.Fatal("cancellation ignored")
	}
	if err := b.Call(context.Background(), "echo", map[string]any{"value": "new"}, &result); err != nil || result.Value != "new" {
		t.Fatalf("response mixup: %+v %v", result, err)
	}
	if err := b.Call(context.Background(), "exit", map[string]any{}, &result); err == nil {
		t.Fatal("process exit ignored")
	}
	if err := b.Call(context.Background(), "echo", map[string]any{"value": "restarted"}, &result); err != nil || result.Value != "restarted" {
		t.Fatalf("restart failed: %+v %v", result, err)
	}
}
