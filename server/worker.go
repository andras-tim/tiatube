package main

import (
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Builder turns a job's received tracks into the file the user asked for.
type Builder struct {
	store     *Store
	transcode *Queue // ffmpeg runs that re-encode
	remux     *Queue // ffmpeg runs that only copy streams
	cover     func(j *Job) string
}

// Run builds the job. ms maps each MediaSource id to its duration, as the window saw them.
func (b *Builder) Run(j *Job, ms map[int]float64) {
	err := b.run(j, ms)
	if err == nil {
		return
	}
	if j.ctx.Err() != nil {
		return // removed: nobody waits for it
	}
	log.Printf("job %s: %v", j.ID, err)
	j.Set(func(s *Status) { s.State, s.Step, s.Pct, s.Queue, s.Error = "error", "", nil, 0, err.Error() })
}

func (b *Builder) run(j *Job, ms map[int]float64) error {
	info := j.Info
	content := map[int]bool{}
	for id, d := range ms {
		if math.Abs(d-info.Duration) < 2 {
			content[id] = true
		}
	}
	j.Set(func(s *Status) { s.State, s.Step = "building", "assemble" })
	j.mu.Lock()
	inits := map[string]map[string]initMeta{}
	for t, m := range j.inits {
		inits[t] = m
	}
	j.mu.Unlock()
	audio, ainfo, err := collectTrack(j.Dir, "audio", inits["audio"], content)
	if err != nil {
		return err
	}
	video, vinfo, err := collectTrack(j.Dir, "video", inits["video"], content)
	if err != nil {
		return err
	}
	for _, t := range []string{"audio", "video"} {
		if err := os.RemoveAll(filepath.Join(j.Dir, t)); err != nil {
			return err
		}
	}
	if err := b.store.Account(j); err != nil {
		return err
	}
	j.Set(func(s *Status) { s.Audio, s.Video = &ainfo, &vinfo })
	if audio == "" {
		return errors.New("no audio")
	}
	if info.What == "video" && video == "" {
		return errors.New("no video")
	}
	j.Set(func(s *Status) { s.Step = "cover" })
	cover := b.cover(j)
	p := buildPlan(info, audio, video, cover, filepath.Join(j.Dir, "out"))
	q := b.remux
	if p.transcode {
		q = b.transcode
	}
	err = q.Acquire(j.ctx, j.ID, func(pos int) {
		j.Set(func(s *Status) { s.State, s.Step, s.Queue = "queued", "", pos })
	})
	if err != nil {
		return err
	}
	defer q.Release()
	zero := 0
	j.Set(func(s *Status) { s.State, s.Step, s.Queue, s.Pct = "building", "encode", 0, &zero })
	err = runFFmpeg(j.ctx, p.args, info.Duration, func(pct int) {
		j.Set(func(s *Status) { s.Pct = &pct })
	})
	if err != nil {
		return err
	}
	// only the result stays
	for _, f := range []string{audio, video, cover} {
		if f != "" {
			os.Remove(f)
		}
	}
	if err := b.store.Account(j); err != nil {
		return err
	}
	complete := complete(ainfo, info.Duration) && (info.What != "video" || complete(vinfo, info.Duration))
	name := safeName(strings.TrimSpace(fmt.Sprintf("%s %s [%s]", info.Prefix, info.Title, info.VideoID))) + "." + p.ext
	j.Set(func(s *Status) {
		s.State, s.Step, s.Pct = "done", "", nil
		s.Files = map[string]string{p.ext: name}
		s.Complete = &complete
	})
	return nil
}

// complete: no gap, starts at the beginning, and the last fragment (about one step long) reaches the end.
func complete(t TrackInfo, duration float64) bool {
	return t.Frags > 0 && t.Gaps == 0 && t.First < 1 && t.Last+t.Step*1.5 >= duration-1
}

var reUnsafe = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

// safeName makes a file name that works on every OS, at most 150 characters.
func safeName(s string) string {
	s = strings.TrimSpace(reUnsafe.ReplaceAllString(s, "_"))
	if utf8.RuneCountInString(s) > 150 {
		s = string([]rune(s)[:150])
	}
	if s == "" {
		return "tiatube"
	}
	return s
}
