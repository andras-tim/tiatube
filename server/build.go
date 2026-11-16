package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var reFrag = regexp.MustCompile(`^ms(\d+)-([a-f0-9]{8})-(\d+)\.frag$`)

// collectTrack concatenates one track's content fragments behind their init segment into <dir>/<track>.<ext>
// and deletes the fragments. A track may hold fragments of several formats (the player switched quality); only the
// format with the most bytes is kept, the others cannot be decoded with its init segment.
// contentMs: the MediaSource ids that carried the video itself (an ad plays in another MediaSource).
func collectTrack(dir, track string, inits map[string]initMeta, contentMs map[int]bool) (string, TrackInfo, error) {
	d := filepath.Join(dir, track)
	entries, err := os.ReadDir(d)
	if err != nil {
		return "", TrackInfo{Reason: "nothing received"}, nil
	}
	type frag struct {
		ts   int64
		path string
		size int64
	}
	groups := map[string]map[int64]frag{}
	for _, e := range entries {
		m := reFrag.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		ms, _ := strconv.Atoi(m[1])
		if !contentMs[ms] {
			continue
		}
		ts, _ := strconv.ParseInt(m[3], 10, 64)
		fi, err := e.Info()
		if err != nil {
			return "", TrackInfo{}, err
		}
		g := groups[m[2]]
		if g == nil {
			g = map[int64]frag{}
			groups[m[2]] = g
		}
		if _, dup := g[ts]; !dup {
			g[ts] = frag{ts, filepath.Join(d, e.Name()), fi.Size()}
		}
	}
	if len(groups) == 0 {
		return "", TrackInfo{Reason: "no content fragments"}, nil
	}
	key, best := "", int64(-1)
	for k, g := range groups {
		var n int64
		for _, f := range g {
			n += f.size
		}
		if n > best || (n == best && k < key) {
			key, best = k, n
		}
	}
	frags := make([]frag, 0, len(groups[key]))
	for _, f := range groups[key] {
		frags = append(frags, f)
	}
	sort.Slice(frags, func(a, b int) bool { return frags[a].ts < frags[b].ts })
	meta := inits[key]
	scale := float64(meta.Scale)
	if scale <= 0 {
		scale = 1000
	}
	secs := make([]float64, len(frags))
	for i, f := range frags {
		secs[i] = float64(f.ts) / scale
	}
	var steps []float64
	for i := 1; i < len(secs); i++ {
		steps = append(steps, secs[i]-secs[i-1])
	}
	sort.Float64s(steps)
	step := 0.0
	if len(steps) > 0 {
		step = steps[len(steps)/2]
	}
	gaps := 0
	for i := 1; i < len(secs); i++ {
		if secs[i]-secs[i-1] > 2.5*step+1 {
			gaps++
		}
	}
	ext := meta.Ext
	if ext == "" {
		ext = "bin"
	}
	out := filepath.Join(dir, track+"."+ext)
	o, err := os.Create(out)
	if err != nil {
		return "", TrackInfo{}, err
	}
	parts := append([]string{filepath.Join(d, "init-"+key+".bin")}, func() []string {
		p := make([]string, len(frags))
		for i, f := range frags {
			p[i] = f.path
		}
		return p
	}()...)
	for _, p := range parts {
		if err := appendFile(o, p); err != nil {
			o.Close()
			return "", TrackInfo{}, err
		}
	}
	if err := o.Close(); err != nil {
		return "", TrackInfo{}, err
	}
	info := TrackInfo{Format: meta.Mime, Formats: len(groups), Frags: len(frags), First: round2(secs[0]),
		Last: round2(secs[len(secs)-1]), Step: round2(step), Gaps: gaps}
	return out, info, nil
}

func appendFile(w io.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// dirSize is the bytes of the regular files under dir.
func dirSize(dir string) int64 {
	var n int64
	filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if fi, err := d.Info(); err == nil {
				n += fi.Size()
			}
		}
		return nil
	})
	return n
}

// plan is one ffmpeg run: its arguments, output extension and whether it re-encodes (the transcode queue).
type plan struct {
	args      []string
	ext       string
	transcode bool
}

// buildPlan picks the ffmpeg run for the job's format; cover is "" without a preview image.
func buildPlan(info JobInfo, audio, video, cover, out string) plan {
	aIsMp4 := strings.HasSuffix(audio, ".mp4")
	var p plan
	switch {
	case info.What == "video" && info.Format == "mp4":
		p.ext = "mp4"
		p.args = []string{"-i", video, "-i", audio}
		if cover != "" {
			p.args = append(p.args, "-i", cover)
		}
		p.args = append(p.args, "-map", "0:v:0", "-map", "1:a:0")
		if cover != "" {
			p.args = append(p.args, "-map", "2:v:0", "-c:v:1", "copy", "-disposition:v:1", "attached_pic")
		}
		p.args = append(p.args, "-c:v:0", "copy")
		if aIsMp4 {
			p.args = append(p.args, "-c:a", "copy")
		} else {
			p.args = append(p.args, "-c:a", "aac", "-b:a", "192k")
			p.transcode = true
		}
		p.args = append(p.args, "-movflags", "+faststart")
	case info.What == "video":
		p.ext = "mkv"
		p.args = []string{"-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy"}
		if cover != "" {
			p.args = append(p.args, "-attach", cover, "-metadata:s:t:0", "mimetype=image/jpeg",
				"-metadata:s:t:0", "filename=cover.jpg")
		}
	case info.Format == "orig":
		// the ogg muxer takes no picture: opus goes without a cover
		pic := cover != "" && aIsMp4
		p.ext = "opus"
		if aIsMp4 {
			p.ext = "m4a"
		}
		p.args = []string{"-i", audio}
		if pic {
			p.args = append(p.args, "-i", cover, "-map", "0:a:0", "-map", "1:v:0", "-c:v", "copy",
				"-disposition:v", "attached_pic")
		} else {
			p.args = append(p.args, "-vn")
		}
		p.args = append(p.args, "-c:a", "copy")
		if aIsMp4 {
			p.args = append(p.args, "-movflags", "+faststart")
		}
	default:
		p.ext = "mp3"
		p.transcode = true
		p.args = []string{"-i", audio}
		if cover != "" {
			p.args = append(p.args, "-i", cover, "-map", "0:a:0", "-map", "1:v:0", "-c:v", "copy",
				"-disposition:v", "attached_pic", "-metadata:s:v", "comment=Cover (front)")
		} else {
			p.args = append(p.args, "-vn")
		}
		p.args = append(p.args, "-c:a", "libmp3lame", "-q:a", "0", "-id3v2_version", "3")
	}
	author := info.Author
	if author == "" {
		author = "tiaTube"
	}
	p.args = append(p.args, "-metadata", "title="+info.Title, "-metadata", "artist="+author,
		"-metadata", "comment="+info.URL)
	if info.Date != "" {
		p.args = append(p.args, "-metadata", "date="+info.Date)
	}
	p.args = append(p.args, out+"."+p.ext)
	return p
}

// runFFmpeg runs ffmpeg; progress gets the percent done when the duration is known. A cancelled ctx kills it.
func runFFmpeg(ctx context.Context, args []string, duration float64, progress func(int)) error {
	cmd := exec.CommandContext(ctx, "ffmpeg", append([]string{"-nostdin", "-hide_banner", "-v", "error", "-y",
		"-progress", "pipe:1"}, args...)...)
	cmd.WaitDelay = 5 * time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		v, ok := strings.CutPrefix(sc.Text(), "out_time_us=")
		if !ok || duration <= 0 || progress == nil {
			continue
		}
		if us, err := strconv.ParseFloat(v, 64); err == nil {
			progress(int(math.Min(100, us/1e6/duration*100)))
		}
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 500 {
			msg = msg[len(msg)-500:]
		}
		return fmt.Errorf("ffmpeg: %v: %s", err, msg)
	}
	return nil
}
