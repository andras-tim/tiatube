package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestParseSize(t *testing.T) {
	cases := map[string]int64{"0": 0, "123": 123, "16MiB": 16 << 20, "6GiB": 6 << 30, "6 GiB": 6 << 30, "1TiB": 1 << 40}
	for in, want := range cases {
		if got, err := parseSize(in); err != nil || got != want {
			t.Errorf("parseSize(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, in := range []string{"", "x", "-1", "6GB"} {
		if _, err := parseSize(in); err == nil {
			t.Errorf("parseSize(%q): no error", in)
		}
	}
}

func TestLoadConfig(t *testing.T) {
	env := map[string]string{"TIATUBE_MAX_JOB": "1GiB", "TIATUBE_MAX_TOTAL": "2GiB", "TIATUBE_ORIGIN": "https://x.test/",
		"TIATUBE_JOB_TTL": "1h"}
	c, err := loadConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if c.MaxJob != 1<<30 || c.MaxTotal != 2<<30 || c.Origin != "https://x.test" || c.JobTTL != time.Hour ||
		c.RemuxParallel != 2 {
		t.Errorf("unexpected config: %+v", c)
	}
	env["TIATUBE_MAX_JOB"] = "3GiB"
	if _, err := loadConfig(func(k string) string { return env[k] }); err == nil {
		t.Error("a job larger than the total was accepted")
	}
}

func TestQueueOrderAndPositions(t *testing.T) {
	q := NewQueue(1)
	ctx := context.Background()
	if err := q.Acquire(ctx, "a", func(int) { t.Error("a waited") }); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	pos := map[string][]int{}
	order := make(chan string, 2)
	wait := func(id string) {
		err := q.Acquire(ctx, id, func(p int) { mu.Lock(); pos[id] = append(pos[id], p); mu.Unlock() })
		if err != nil {
			t.Error(err)
		}
		order <- id
	}
	go wait("b")
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(pos["b"]) == 1 })
	go wait("c")
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(pos["c"]) == 1 })
	q.Release()
	if got := <-order; got != "b" {
		t.Fatalf("first after a: %s", got)
	}
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(pos["c"]) == 2 })
	q.Release()
	if got := <-order; got != "c" {
		t.Fatalf("second after a: %s", got)
	}
	q.Release()
	mu.Lock()
	defer mu.Unlock()
	if len(pos["b"]) != 1 || pos["b"][0] != 1 || pos["c"][0] != 2 || pos["c"][1] != 1 {
		t.Errorf("positions: %v", pos)
	}
}

func TestQueueCancel(t *testing.T) {
	q := NewQueue(1)
	q.Acquire(context.Background(), "a", nil)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)
	go func() { done <- q.Acquire(ctx, "b", func(int) {}) }()
	cancel()
	if err := <-done; err == nil {
		t.Fatal("a cancelled wait returned nil")
	}
	q.Release()
	if err := q.Acquire(context.Background(), "c", func(int) { t.Error("c waited behind a cancelled job") }); err != nil {
		t.Fatal(err)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out")
}

func TestSafeName(t *testing.T) {
	cases := map[string]string{"a/b:c?": "a_b_c_", "  x  ": "x", "": "tiatube", "árvíztűrő": "árvíztűrő",
		"a\x00\x01b": "a_b"}
	for in, want := range cases {
		if got := safeName(in); got != want {
			t.Errorf("safeName(%q) = %q; want %q", in, got, want)
		}
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "é"
	}
	if got := []rune(safeName(long)); len(got) != 150 {
		t.Errorf("long name: %d characters", len(got))
	}
}

func TestContentDisposition(t *testing.T) {
	got := contentDisposition(`Ár "x".mp3`)
	want := `attachment; filename="?r _x_.mp3"; filename*=UTF-8''%C3%81r%20%22x%22.mp3`
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

func TestCoverAllowed(t *testing.T) {
	ok := []string{"https://i.ytimg.com/vi/x/maxresdefault.jpg", "https://scontent-vie1-1.xx.fbcdn.net/v/a.jpg"}
	bad := []string{"http://i.ytimg.com/a.jpg", "https://ytimg.com.evil.test/a.jpg", "https://evilytimg.com/a.jpg",
		"https://127.0.0.1/a.jpg", "https://u:p@i.ytimg.com/a.jpg", "https://i.ytimg.com:8443/a.jpg", "file:///etc/passwd"}
	for _, u := range ok {
		if !coverAllowed(u) {
			t.Errorf("refused: %s", u)
		}
	}
	for _, u := range bad {
		if coverAllowed(u) {
			t.Errorf("allowed: %s", u)
		}
	}
}

func TestCollectTrack(t *testing.T) {
	dir := t.TempDir()
	d := filepath.Join(dir, "audio")
	os.Mkdir(d, 0o700)
	write := func(name, body string) { os.WriteFile(filepath.Join(d, name), []byte(body), 0o600) }
	write("init-aaaaaaaa.bin", "I")
	write("init-bbbbbbbb.bin", "J")
	// format aaaaaaaa: 0..7 s, a gap after 2 s; bbbbbbbb: a short, smaller run; ms 9: an ad
	for _, ts := range []int{0, 1000, 2000, 6000, 7000} {
		write("ms1-aaaaaaaa-"+leftPad(int64(ts), 15)+".frag", "ab")
	}
	write("ms1-bbbbbbbb-000000000003000.frag", "x")
	write("ms9-aaaaaaaa-000000000007000.frag", "AD")
	inits := map[string]initMeta{"aaaaaaaa": {Mime: "audio/mp4", Scale: 1000, Ext: "mp4"}}
	out, info, err := collectTrack(dir, "audio", inits, map[int]bool{1: true})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(out)
	if filepath.Base(out) != "audio.mp4" || string(data) != "Iababababab" {
		t.Errorf("out %s: %q", out, data)
	}
	if info.Formats != 2 || info.Frags != 5 || info.First != 0 || info.Last != 7 || info.Step != 1 || info.Gaps != 1 {
		t.Errorf("info: %+v", info)
	}
	if _, info, _ := collectTrack(dir, "video", nil, nil); info.Reason != "nothing received" {
		t.Errorf("missing track: %+v", info)
	}
}

func TestComplete(t *testing.T) {
	if !complete(TrackInfo{Frags: 5, First: 0, Last: 4, Step: 1}, 5) {
		t.Error("whole track counted as incomplete")
	}
	if complete(TrackInfo{Frags: 3, First: 0, Last: 2, Step: 1}, 5) {
		t.Error("short track counted as complete")
	}
	if complete(TrackInfo{Frags: 5, First: 0, Last: 4, Step: 1, Gaps: 1}, 5) {
		t.Error("track with a gap counted as complete")
	}
}

func TestStoreLimits(t *testing.T) {
	cfg := Config{Data: filepath.Join(t.TempDir(), "data"), MaxJob: 100, MaxTotal: 250}
	s, err := NewStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := s.Create(JobInfo{})
	b, _ := s.Create(JobInfo{})
	if err := s.Reserve(a, 101); err != errJobTooLarge {
		t.Errorf("job limit: %v", err)
	}
	if err := s.Reserve(a, 100); err != nil {
		t.Fatal(err)
	}
	if err := s.Reserve(b, 60); err != nil {
		t.Fatal(err)
	}
	// 160 used: a third job of 100 would not fit
	if _, err := s.Create(JobInfo{}); err != errServerFull {
		t.Errorf("full server accepted a job: %v", err)
	}
	s.Remove(a)
	if _, err := s.Create(JobInfo{}); err != nil {
		t.Errorf("after a removal: %v", err)
	}
	if _, err := os.Stat(a.Dir); !os.IsNotExist(err) {
		t.Error("removed job's directory is still there")
	}
}

func TestJanitor(t *testing.T) {
	cfg := Config{Data: filepath.Join(t.TempDir(), "data"), MaxJob: 100, MaxTotal: 1000, JobTTL: time.Hour,
		IdleTimeout: time.Minute}
	s, _ := NewStore(cfg)
	idle, _ := s.Create(JobInfo{})
	done, _ := s.Create(JobInfo{})
	done.Set(func(st *Status) { st.State = "done" })
	fresh, _ := s.Create(JobInfo{})
	now := time.Now()
	idle.seen = now.Add(-2 * time.Minute)
	done.ended = now.Add(-2 * time.Hour)
	s.sweep(now)
	if s.Get(idle.ID) != nil || s.Get(done.ID) != nil || s.Get(fresh.ID) == nil {
		t.Error("janitor kept or dropped the wrong jobs")
	}
}

func TestFillBookmarklet(t *testing.T) {
	src := []byte("run('__TT_ORIGIN__', 'n=1')")
	if got, want := fillBookmarklet(src, "https://tt.example"), "run('https://tt.example', 'n=1')"; got != want {
		t.Fatalf("fillBookmarklet = %q, want %q", got, want)
	}
}
