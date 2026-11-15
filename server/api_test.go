package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The end-to-end tests run ffmpeg: they make fragmented MP4 tracks, upload them the way the window does and
// check what the server builds.

func needFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
}

// fragmented makes a 5 s fragmented MP4 track with 1 s fragments and splits it into init + fragments.
func fragmented(t *testing.T, kind string) (init []byte, frags [][]byte) {
	t.Helper()
	out := filepath.Join(t.TempDir(), kind+".mp4")
	args := []string{"-v", "error", "-y"}
	if kind == "audio" {
		args = append(args, "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "aac")
	} else {
		args = append(args, "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=5", "-c:v", "libx264",
			"-g", "10", "-pix_fmt", "yuv420p")
	}
	args = append(args, "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", out)
	if b, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v: %s", err, b)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	// top-level boxes: ftyp, moov = init; then moof + mdat pairs
	var cur []byte
	for len(data) >= 8 {
		size := int(binary.BigEndian.Uint32(data))
		typ := string(data[4:8])
		box := data[:size]
		data = data[size:]
		switch typ {
		case "ftyp", "moov":
			init = append(init, box...)
		case "moof":
			cur = append([]byte{}, box...)
		case "mdat":
			frags = append(frags, append(cur, box...))
		}
	}
	return init, frags
}

type testServer struct {
	*httptest.Server
	t *testing.T
}

func newTestServer(t *testing.T, cfg Config) *testServer {
	cfg.Data = filepath.Join(t.TempDir(), "data")
	if cfg.MaxFrag == 0 {
		cfg.MaxFrag, cfg.MaxJob, cfg.MaxTotal = 16<<20, 64<<20, 256<<20
	}
	if cfg.RemuxParallel == 0 {
		cfg.RemuxParallel = 2
	}
	store, err := NewStore(cfg)
	if err != nil {
		t.Fatal(err)
	}
	web, _ := NewWeb(cfg)
	b := &Builder{store: store, transcode: NewQueue(1), remux: NewQueue(cfg.RemuxParallel),
		cover: func(*Job) string { return "" }}
	ts := httptest.NewServer((&API{cfg: cfg, store: store, builder: b, web: web}).routes())
	t.Cleanup(ts.Close)
	return &testServer{ts, t}
}

func (s *testServer) post(path string, body []byte) (int, map[string]any) {
	s.t.Helper()
	r, err := http.Post(s.URL+path, "application/octet-stream", bytes.NewReader(body))
	if err != nil {
		s.t.Fatal(err)
	}
	defer r.Body.Close()
	var m map[string]any
	json.NewDecoder(r.Body).Decode(&m)
	return r.StatusCode, m
}

func (s *testServer) status(job string) Status {
	s.t.Helper()
	r, err := http.Get(s.URL + "/api/status?job=" + job)
	if err != nil {
		s.t.Fatal(err)
	}
	defer r.Body.Close()
	var st Status
	json.NewDecoder(r.Body).Decode(&st)
	return st
}

func (s *testServer) job(info map[string]any) string {
	s.t.Helper()
	b, _ := json.Marshal(info)
	code, m := s.post("/api/job", b)
	if code != 200 {
		s.t.Fatalf("job: %d %v", code, m)
	}
	return m["job"].(string)
}

func (s *testServer) upload(job, track string, init []byte, frags [][]byte) {
	s.t.Helper()
	sum := sha256.Sum256(init)
	key := hex.EncodeToString(sum[:])[:8]
	mime := track + `/mp4; codecs="x"`
	if code, m := s.post(fmt.Sprintf("/api/frag?job=%s&track=%s&kind=init&key=%s&mime=%s&scale=1000", job, track, key,
		strings.ReplaceAll(mime, " ", "%20")), init); code != 200 {
		s.t.Fatalf("init: %d %v", code, m)
	}
	for i, f := range frags {
		if code, m := s.post(fmt.Sprintf("/api/frag?job=%s&track=%s&kind=frag&key=%s&ms=1&ts=%d", job, track, key,
			i*1000), f); code != 200 {
			s.t.Fatalf("frag %d: %d %v", i, code, m)
		}
	}
}

func (s *testServer) wait(job string, until func(Status) bool) Status {
	s.t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		st := s.status(job)
		if until(st) {
			return st
		}
		time.Sleep(50 * time.Millisecond)
	}
	s.t.Fatalf("job %s: timed out", job)
	return Status{}
}

func isDone(st Status) bool { return st.State == "done" || st.State == "error" }

func probe(t *testing.T, path string) string {
	t.Helper()
	b, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name",
		"-of", "csv=p=0", path).Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	return strings.Join(strings.Fields(string(b)), " ")
}

func TestBuildMP3AndMKV(t *testing.T) {
	needFFmpeg(t)
	ainit, afrags := fragmented(t, "audio")
	vinit, vfrags := fragmented(t, "video")
	s := newTestServer(t, Config{})
	finish, _ := json.Marshal(map[string]any{"ms": map[string]float64{"1": 5}})

	mp3 := s.job(map[string]any{"title": "Teszt: árvíztűrő", "videoId": "abc", "duration": 5, "what": "audio",
		"format": "mp3", "prefix": "2026-11-15"})
	s.upload(mp3, "audio", ainit, afrags)
	s.post("/api/finish?job="+mp3, finish)
	st := s.wait(mp3, isDone)
	if st.State != "done" || st.Complete == nil || !*st.Complete || st.Files["mp3"] != "2026-11-15 Teszt_ árvíztűrő [abc].mp3" {
		t.Fatalf("mp3: %+v (audio %+v)", st, st.Audio)
	}

	mkv := s.job(map[string]any{"title": "v", "duration": 5, "what": "video", "format": "mkv"})
	s.upload(mkv, "audio", ainit, afrags)
	s.upload(mkv, "video", vinit, vfrags)
	s.post("/api/finish?job="+mkv, finish)
	if st := s.wait(mkv, isDone); st.State != "done" || !*st.Complete {
		t.Fatalf("mkv: %+v", st)
	}

	for job, kind := range map[string]string{mp3: "mp3", mkv: "mkv"} {
		r, err := http.Get(s.URL + "/api/file?job=" + job + "&f=" + kind)
		if err != nil || r.StatusCode != 200 {
			t.Fatalf("file %s: %v %v", kind, err, r.Status)
		}
		f := filepath.Join(t.TempDir(), "out."+kind)
		data, _ := io.ReadAll(r.Body)
		r.Body.Close()
		os.WriteFile(f, data, 0o600)
		want := map[string]string{"mp3": "mp3,audio", "mkv": "h264,video aac,audio"}[kind]
		if got := probe(t, f); got != want {
			t.Errorf("%s streams: %q; want %q", kind, got, want)
		}
		if kind == "mp3" && !strings.Contains(r.Header.Get("Content-Disposition"), "filename*=UTF-8''2026-11-15") {
			t.Errorf("content disposition: %s", r.Header.Get("Content-Disposition"))
		}
	}
}

func TestTranscodeQueueAndCancel(t *testing.T) {
	needFFmpeg(t)
	ainit, afrags := fragmented(t, "audio")
	s := newTestServer(t, Config{})
	finish, _ := json.Marshal(map[string]any{"ms": map[string]float64{"1": 5}})
	// three MP3 jobs at once share the single transcode slot; the waiting order is tested in TestQueueOrderAndPositions
	var jobs []string
	for i := 0; i < 3; i++ {
		j := s.job(map[string]any{"title": strconv.Itoa(i), "duration": 5, "format": "mp3"})
		s.upload(j, "audio", ainit, afrags)
		jobs = append(jobs, j)
	}
	for _, j := range jobs {
		s.post("/api/finish?job="+j, finish)
	}
	for _, j := range jobs {
		if st := s.wait(j, isDone); st.State != "done" {
			t.Errorf("job %s: %+v", j, st)
		}
	}

	// cancel: the job and its files go away
	j := s.job(map[string]any{"title": "c", "duration": 5, "format": "mp3"})
	s.upload(j, "audio", ainit, afrags[:2])
	if code, _ := s.post("/api/cancel?job="+j, nil); code != 200 {
		t.Fatalf("cancel: %d", code)
	}
	if r, _ := http.Get(s.URL + "/api/status?job=" + j); r.StatusCode != 404 {
		t.Errorf("cancelled job still answers: %d", r.StatusCode)
	}
}

func TestRejects(t *testing.T) {
	s := newTestServer(t, Config{MaxFrag: 10, MaxJob: 15, MaxTotal: 100})
	j := s.job(map[string]any{"title": "x"})
	if code, _ := s.post("/api/frag?job="+j+"&track=audio&kind=frag&key=aaaaaaaa&ms=1&ts=0", make([]byte, 11)); code != 413 {
		t.Errorf("oversized fragment: %d", code)
	}
	s.post("/api/frag?job="+j+"&track=audio&kind=frag&key=aaaaaaaa&ms=1&ts=0", make([]byte, 10))
	if code, _ := s.post("/api/frag?job="+j+"&track=audio&kind=frag&key=aaaaaaaa&ms=1&ts=1", make([]byte, 10)); code != 413 {
		t.Errorf("job over its limit: %d", code)
	}
	if code, _ := s.post("/api/frag?job="+j+"&track=../x&kind=frag&key=aaaaaaaa&ms=1&ts=0", nil); code != 400 {
		t.Errorf("bad track: %d", code)
	}
	if code, _ := s.post("/api/frag?job="+j+"&track=audio&kind=init&key=aaaaaaaa", []byte("x")); code != 400 {
		t.Errorf("init with a wrong key: %d", code)
	}
	if code, _ := s.post("/api/frag?job=../../etc&track=audio&kind=frag&key=aaaaaaaa&ms=1&ts=0", nil); code != 404 {
		t.Errorf("bad job id: %d", code)
	}
	if r, _ := http.Get(s.URL + "/api/file?job=" + j + "&f=mp3"); r.StatusCode != 404 {
		t.Errorf("file of an unfinished job: %d", r.StatusCode)
	}
	if code, _ := s.post("/api/debug-zip", []byte("x")); code != 405 && code != 404 {
		t.Errorf("test endpoint without test mode: %d", code)
	}
}
