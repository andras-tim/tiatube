package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var (
	errJobTooLarge = errors.New("job too large")
	errServerFull  = errors.New("server storage full")
	reJobID        = regexp.MustCompile(`^[a-f0-9]{16}$`)
)

// JobInfo is what the window tells about the media; validated on creation.
type JobInfo struct {
	VideoID  string   `json:"videoId"`
	Title    string   `json:"title"`
	Author   string   `json:"author"`
	Date     string   `json:"date"`   // YYYY-MM-DD
	Prefix   string   `json:"prefix"` // a date stamp in front of the file name
	URL      string   `json:"url"`
	Thumb    string   `json:"thumb"`  // the preview image
	Thumbs   []string `json:"thumbs"` // or candidates for it, best first
	Duration float64  `json:"duration"`
	What     string   `json:"what"`   // audio | video
	Format   string   `json:"format"` // mp3 | orig | mp4 | mkv
}

type TrackInfo struct {
	Reason  string  `json:"reason,omitempty"`
	Format  string  `json:"format,omitempty"`
	Formats int     `json:"formats,omitempty"`
	Frags   int     `json:"frags,omitempty"`
	First   float64 `json:"first"`
	Last    float64 `json:"last"`
	Step    float64 `json:"step"`
	Gaps    int     `json:"gaps"`
}

// Status is what /api/status returns. The window turns the codes into text; the server sends no UI text.
type Status struct {
	State    string            `json:"state"`          // receiving | queued | building | done | error
	Step     string            `json:"step,omitempty"` // while building: assemble | cover | encode
	Pct      *int              `json:"pct,omitempty"`  // while encoding
	Queue    int               `json:"queue,omitempty"`
	Error    string            `json:"error,omitempty"`
	Files    map[string]string `json:"files,omitempty"`
	Complete *bool             `json:"complete,omitempty"`
	Audio    *TrackInfo        `json:"audio,omitempty"`
	Video    *TrackInfo        `json:"video,omitempty"`
}

type initMeta struct {
	Mime  string
	Scale int64
	Ext   string
}

type Job struct {
	ID     string
	Dir    string
	Info   JobInfo
	ctx    context.Context
	cancel context.CancelFunc

	mu       sync.Mutex
	st       Status
	inits    map[string]map[string]initMeta // track -> init key -> meta
	bytes    int64
	seen     time.Time // last request: an abandoned receiving job is dropped
	finished bool      // /api/finish came
	ended    time.Time // done or error: the TTL counts from here
}

func (j *Job) Status() Status {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.st
}

func (j *Job) Set(f func(*Status)) {
	j.mu.Lock()
	f(&j.st)
	if (j.st.State == "done" || j.st.State == "error") && j.ended.IsZero() {
		j.ended = time.Now()
	}
	j.mu.Unlock()
}

func (j *Job) touch() {
	j.mu.Lock()
	j.seen = time.Now()
	j.mu.Unlock()
}

// Store holds the jobs in memory; their files are under cfg.Data/<id>.
type Store struct {
	cfg   Config
	mu    sync.Mutex
	jobs  map[string]*Job
	total int64
}

func NewStore(cfg Config) (*Store, error) {
	if err := os.MkdirAll(cfg.Data, 0o700); err != nil {
		return nil, err
	}
	// jobs of an earlier run cannot be continued; the directory itself may be a mount point, so only its content goes
	entries, err := os.ReadDir(cfg.Data)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(cfg.Data, e.Name())); err != nil {
			return nil, err
		}
	}
	return &Store{cfg: cfg, jobs: map[string]*Job{}}, nil
}

func (s *Store) Create(info JobInfo) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// a new job starts only when a job of the largest size still fits
	if s.total > s.cfg.MaxTotal-s.cfg.MaxJob {
		return nil, errServerFull
	}
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	id := hex.EncodeToString(b)
	dir := filepath.Join(s.cfg.Data, id)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &Job{ID: id, Dir: dir, Info: info, ctx: ctx, cancel: cancel, seen: time.Now(),
		inits: map[string]map[string]initMeta{}, st: Status{State: "receiving"}}
	s.jobs[id] = j
	return j, nil
}

func (s *Store) Get(id string) *Job {
	if !reJobID.MatchString(id) {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jobs[id]
}

// Reserve accounts n more bytes on disk for the job, or refuses them.
func (s *Store) Reserve(j *Job, n int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.bytes+n > s.cfg.MaxJob {
		return errJobTooLarge
	}
	if s.total+n > s.cfg.MaxTotal {
		return errServerFull
	}
	j.bytes += n
	s.total += n
	return nil
}

// Release gives back bytes the job deleted.
func (s *Store) Release(j *Job, n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j.mu.Lock()
	defer j.mu.Unlock()
	j.bytes -= n
	s.total -= n
}

// Remove stops the job (a running ffmpeg is killed) and deletes its files.
func (s *Store) Remove(j *Job) {
	j.cancel()
	s.mu.Lock()
	delete(s.jobs, j.ID)
	j.mu.Lock()
	s.total -= j.bytes
	j.bytes = 0
	j.mu.Unlock()
	s.mu.Unlock()
	if err := os.RemoveAll(j.Dir); err != nil {
		log.Printf("job %s: remove: %v", j.ID, err)
	}
}

// Janitor drops finished jobs after the TTL and abandoned receiving jobs after the idle timeout.
func (s *Store) Janitor(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.sweep(time.Now())
		}
	}
}

func (s *Store) sweep(now time.Time) {
	s.mu.Lock()
	var old []*Job
	for _, j := range s.jobs {
		j.mu.Lock()
		expired := !j.ended.IsZero() && now.Sub(j.ended) > s.cfg.JobTTL
		idle := j.ended.IsZero() && !j.finished && now.Sub(j.seen) > s.cfg.IdleTimeout
		j.mu.Unlock()
		if expired || idle {
			old = append(old, j)
		}
	}
	s.mu.Unlock()
	for _, j := range old {
		log.Printf("job %s: dropped by the janitor", j.ID)
		s.Remove(j)
	}
}

// Account sets the job's usage to what its directory holds now (after a step created or deleted files).
func (s *Store) Account(j *Job) error {
	n := dirSize(j.Dir)
	s.mu.Lock()
	defer s.mu.Unlock()
	j.mu.Lock()
	defer j.mu.Unlock()
	s.total += n - j.bytes
	j.bytes = n
	if n > s.cfg.MaxJob {
		return errJobTooLarge
	}
	return nil
}
