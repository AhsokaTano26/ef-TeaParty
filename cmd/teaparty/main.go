package main

import (
	"context"
	"ef-teaparty/internal/netease"
	"ef-teaparty/internal/party"
	"ef-teaparty/internal/server"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "HTTP 监听地址，局域网使用 0.0.0.0:8080")
	data := flag.String("data", "data", "持久化目录")
	web := flag.String("web", "web/dist", "前端构建目录")
	assets := flag.String("assets", "assets", "PPT 素材目录")
	seed := flag.String("seed", "", "首次启动题库；未指定时读取本地 assets/seed.json，缺少时使用空白模板")
	neteaseBridge := flag.String("netease-bridge", "integrations/netease/bridge.cjs", "网易云本机适配组件路径")
	flag.Parse()
	cfg, e := loadSeed(*seed)
	if e != nil {
		log.Fatal(e)
	}
	store, e := party.Open(filepath.Join(*data, "state.json"), cfg)
	if e != nil {
		log.Fatal(e)
	}
	password := os.Getenv("TEAPARTY_ADMIN_PASSWORD")
	if password == "" {
		password = party.NewID()
		log.Printf("本次启动的后台密码：%s（可通过 TEAPARTY_ADMIN_PASSWORD 固定）", password)
	}
	music := netease.NewService(netease.NewBridge(*neteaseBridge), filepath.Join(*data, "netease"))
	defer music.Close()
	srv := &http.Server{Addr: *addr, Handler: server.New(store, password, filepath.Join(*data, "media"), *assets, *web, server.WithNetease(music)), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	log.Printf("冬日茶话会：http://%s / 投影：/stage", *addr)
	if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
