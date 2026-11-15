package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// coverHosts are the only hosts a preview image is fetched from: the server never fetches a URL a client chose.
var coverHosts = []string{"ytimg.com", "fbcdn.net"}

const maxCover = 5 << 20

func coverAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	for _, d := range coverHosts {
		if h == d || strings.HasSuffix(h, "."+d) {
			return true
		}
	}
	return false
}

var coverClient = &http.Client{
	Timeout: 15 * time.Second,
	CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 3 || !coverAllowed(r.URL.String()) {
			return errors.New("redirect not allowed")
		}
		return nil
	},
}

// fetchCover saves the job's first available preview image as cover.jpg (at most 1280 px wide) and returns its
// path, or "": a missing cover never fails the job.
func fetchCover(j *Job) string {
	for _, t := range j.Info.Thumbs {
		if fetchCoverErr(j.ctx, t, j.Dir) == nil {
			return filepath.Join(j.Dir, "cover.jpg")
		}
	}
	return ""
}

func fetchCoverErr(ctx context.Context, thumb, dir string) error {
	if !coverAllowed(thumb) {
		return errors.New("cover host not allowed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, thumb, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := coverClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "image/") {
		return fmt.Errorf("cover: %s %s", resp.Status, resp.Header.Get("Content-Type"))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCover+1))
	if err != nil {
		return err
	}
	if len(data) > maxCover {
		return errors.New("cover too large")
	}
	src := filepath.Join(dir, "thumb.img")
	defer os.Remove(src)
	if err := os.WriteFile(src, data, 0o600); err != nil {
		return err
	}
	// webp and friends: a plain JPEG every player shows
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-frames:v", "1",
		"-vf", "scale='min(1280,iw)':-2", "-q:v", "3", filepath.Join(dir, "cover.jpg")).Run()
}
