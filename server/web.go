package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"html"
	"io/fs"
	"net/http"
	"os"
	"strings"
)

// The web files (window, install page, bookmarklet, assets) are built into web/ before the server is compiled.
//
//go:embed all:web
var embedded embed.FS

type Web struct {
	cfg   Config
	files fs.FS
}

func NewWeb(cfg Config) (*Web, error) {
	if cfg.WebDir != "" {
		return &Web{cfg: cfg, files: os.DirFS(cfg.WebDir)}, nil
	}
	sub, err := fs.Sub(embedded, "web")
	return &Web{cfg: cfg, files: sub}, err
}

func (wb *Web) serve(w http.ResponseWriter, name, ctype string, data []byte) {
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(data)
}

func (wb *Web) page(w http.ResponseWriter, r *http.Request) {
	data, err := fs.ReadFile(wb.files, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	wb.serve(w, "index.html", "text/html; charset=utf-8", data)
}

// origin is the public URL of this server: configured, or the one the browser used.
func (wb *Web) origin(r *http.Request) string {
	if wb.cfg.Origin != "" {
		return wb.cfg.Origin
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// install serves the install page with the bookmarklet of this server's origin in it.
func (wb *Web) install(w http.ResponseWriter, r *http.Request) {
	page, err1 := fs.ReadFile(wb.files, "install.html")
	src, err2 := fs.ReadFile(wb.files, "bookmarklet.js")
	if err1 != nil || err2 != nil {
		http.NotFound(w, r)
		return
	}
	href := bookmarkletHref(string(src), wb.origin(r))
	page = bytes.ReplaceAll(page, []byte("__TT_BOOKMARKLET_HREF__"), []byte(html.EscapeString(href)))
	wb.serve(w, "install.html", "text/html; charset=utf-8", page)
}

// bookmarkletHref turns the bookmarklet source into a javascript: URL; whole-line // comments are dropped.
func bookmarkletHref(src, origin string) string {
	var lines []string
	for _, l := range strings.Split(src, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(l), "//") {
			lines = append(lines, l)
		}
	}
	return "javascript:" + percentEncode(strings.ReplaceAll(strings.Join(lines, "\n"), "__TT_ORIGIN__", origin))
}

func (wb *Web) asset(w http.ResponseWriter, r *http.Request) {
	http.StripPrefix("/", http.FileServerFS(wb.files)).ServeHTTP(w, r)
}

// testLoader is a page that sends the bookmarklet to the window that opened it, for browser tests that run the
// bookmarklet on a video page the way the bookmark would (test mode only). It opens in the window the bookmarklet
// uses, so the bookmarklet only navigates it. The video page needs a listener:
//
//	addEventListener('message', (e) => e.data && e.data.ttTestCode && (0, eval)(e.data.ttTestCode))
func (wb *Web) testLoader(w http.ResponseWriter, r *http.Request) {
	src, err := fs.ReadFile(wb.files, "bookmarklet.js")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	code, _ := json.Marshal(strings.ReplaceAll(string(src), "__TT_ORIGIN__", wb.origin(r)))
	page := "<!doctype html><meta charset=utf-8><script>opener.postMessage({ttTestCode: " + string(code) +
		"}, '*')</script>"
	wb.serve(w, "loader.html", "text/html; charset=utf-8", []byte(page))
}
