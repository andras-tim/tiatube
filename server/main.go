// tiaTube server: receives what the bookmarklet captured in the user's browser and builds the file with ffmpeg.
// It never downloads from a video site; the only outgoing request is a preview image from an allowlisted host.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg, err := loadConfig(getenv())
	if err != nil {
		log.Fatal(err)
	}
	store, err := NewStore(cfg)
	if err != nil {
		log.Fatal(err)
	}
	web, err := NewWeb(cfg)
	if err != nil {
		log.Fatal(err)
	}
	builder := &Builder{store: store, transcode: NewQueue(1), remux: NewQueue(cfg.RemuxParallel), cover: fetchCover}
	api := &API{cfg: cfg, store: store, builder: builder, web: web}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go store.Janitor(ctx, time.Minute)

	srv := &http.Server{Addr: cfg.Listen, Handler: api.routes(), ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout: 2 * time.Minute}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	log.Printf("tiatube listening on %s", cfg.Listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Print(err)
		os.Exit(1)
	}
}
