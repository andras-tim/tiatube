package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var (
	reKey    = regexp.MustCompile(`^[a-f0-9]{8}$`)
	reDate   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	rePrefix = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}|\d{8}-\d{6})$`)
	formats  = map[string]bool{"mp3": true, "orig": true, "mp4": true, "mkv": true}
	ctypes   = map[string]string{"mp3": "audio/mpeg", "m4a": "audio/mp4", "opus": "audio/ogg", "mp4": "video/mp4",
		"mkv": "video/x-matroska"}
)

type API struct {
	cfg     Config
	store   *Store
	builder *Builder
	web     *Web
}

func (a *API) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /{$}", a.web.install)
	m.HandleFunc("GET /window", a.web.page)
	m.HandleFunc("GET /install", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "./", http.StatusMovedPermanently)
	})
	m.HandleFunc("GET /assets/", a.web.asset)
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok\n") })
	m.HandleFunc("POST /api/job", a.createJob)
	m.HandleFunc("POST /api/frag", a.withJob(a.frag))
	m.HandleFunc("POST /api/finish", a.withJob(a.finish))
	m.HandleFunc("POST /api/cancel", a.withJob(a.cancel))
	m.HandleFunc("GET /api/status", a.withJob(a.status))
	m.HandleFunc("GET /api/file", a.withJob(a.file))
	if a.cfg.Test {
		m.HandleFunc("POST /api/debug-zip", a.debugZip)
		m.HandleFunc("GET /api/test/loader", a.web.testLoader)
	}
	// a page of another site may not start or feed a job through the visitor's browser: POSTs that the browser marks
	// as cross-site (Sec-Fetch-Site, else Origin) are refused; a job's GETs need its random id
	return headers(http.NewCrossOriginProtection().Handler(m))
}

func headers(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// storageError maps the limits to their HTTP codes.
func storageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errJobTooLarge):
		fail(w, http.StatusRequestEntityTooLarge, err.Error())
	case errors.Is(err, errServerFull):
		fail(w, http.StatusInsufficientStorage, err.Error())
	default:
		log.Printf("storage: %v", err)
		fail(w, http.StatusInternalServerError, "storage error")
	}
}

func cut(s string, n int) string {
	if utf8.RuneCountInString(s) > n {
		return string([]rune(s)[:n])
	}
	return s
}

func (a *API) createJob(w http.ResponseWriter, r *http.Request) {
	var in JobInfo
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "bad job")
		return
	}
	info := JobInfo{Name: cut(in.Name, 200), VideoID: cut(in.VideoID, 32), Title: cut(in.Title, 300), Author: cut(in.Author, 200),
		Duration: in.Duration, What: "audio", Format: "mp3"}
	if reDate.MatchString(in.Date) {
		info.Date = in.Date
	}
	if rePrefix.MatchString(in.Prefix) {
		info.Prefix = in.Prefix
	}
	if strings.HasPrefix(in.URL, "https://") {
		info.URL = cut(in.URL, 1000)
	}
	for _, t := range append(in.Thumbs, in.Thumb) {
		if strings.HasPrefix(t, "https://") && len(info.Thumbs) < 4 {
			info.Thumbs = append(info.Thumbs, cut(t, 2000))
		}
	}
	if in.What == "video" {
		info.What = "video"
	}
	if formats[in.Format] {
		info.Format = in.Format
	}
	if info.Duration < 0 || info.Duration > 7*24*3600 {
		info.Duration = 0
	}
	j, err := a.store.Create(info)
	if err != nil {
		storageError(w, err)
		return
	}
	log.Printf("job %s: %s %s", j.ID, info.What, info.Format)
	writeJSON(w, http.StatusOK, map[string]any{"job": j.ID, "maxFrag": a.cfg.MaxFrag})
}

func (a *API) withJob(h func(http.ResponseWriter, *http.Request, *Job)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		j := a.store.Get(r.URL.Query().Get("job"))
		if j == nil {
			fail(w, http.StatusNotFound, "no such job")
			return
		}
		j.touch()
		h(w, r, j)
	}
}

func (a *API) frag(w http.ResponseWriter, r *http.Request, j *Job) {
	q := r.URL.Query()
	track, kind, key := q.Get("track"), q.Get("kind"), q.Get("key")
	if (track != "audio" && track != "video") || (kind != "init" && kind != "frag") || !reKey.MatchString(key) {
		fail(w, http.StatusBadRequest, "bad params")
		return
	}
	ms, err1 := strconv.Atoi(q.Get("ms"))
	ts, err2 := strconv.ParseInt(q.Get("ts"), 10, 64)
	if kind == "frag" && (err1 != nil || err2 != nil || ms < 0 || ts < 0) {
		fail(w, http.StatusBadRequest, "bad params")
		return
	}
	j.mu.Lock()
	finished := j.finished
	j.mu.Unlock()
	if finished {
		fail(w, http.StatusConflict, "job already finished")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, a.cfg.MaxFrag))
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "fragment too large")
		return
	}
	var name string
	if kind == "init" {
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:])[:8] != key {
			fail(w, http.StatusBadRequest, "init key mismatch")
			return
		}
		mt := cut(q.Get("mime"), 100)
		scale, _ := strconv.ParseInt(q.Get("scale"), 10, 64)
		if scale <= 0 {
			scale = 1000
		}
		ext := "webm"
		if strings.Contains(mt, "mp4") {
			ext = "mp4"
		}
		j.mu.Lock()
		if j.inits[track] == nil {
			j.inits[track] = map[string]initMeta{}
		}
		j.inits[track][key] = initMeta{Mime: mt, Scale: scale, Ext: ext}
		j.mu.Unlock()
		name = "init-" + key + ".bin"
	} else {
		name = "ms" + strconv.Itoa(ms) + "-" + key + "-" + leftPad(ts, 15) + ".frag"
	}
	if err := a.store.Reserve(j, int64(len(data))); err != nil {
		storageError(w, err)
		return
	}
	dir := filepath.Join(j.Dir, track)
	path := filepath.Join(dir, name)
	// Mkdir, not MkdirAll: a removed job's directory must not come back
	if err = os.Mkdir(dir, 0o700); os.IsExist(err) {
		err = nil
	}
	if err == nil {
		err = writeAtomic(path, data)
	}
	if err != nil {
		a.store.Release(j, int64(len(data)))
		if j.ctx.Err() != nil {
			fail(w, http.StatusNotFound, "no such job")
			return
		}
		storageError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func leftPad(n int64, width int) string {
	s := strconv.FormatInt(n, 10)
	if len(s) < width {
		s = strings.Repeat("0", width-len(s)) + s
	}
	return s
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (a *API) finish(w http.ResponseWriter, r *http.Request, j *Job) {
	var in struct {
		Ms map[string]float64 `json:"ms"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "bad finish")
		return
	}
	ms := map[int]float64{}
	for k, v := range in.Ms {
		if id, err := strconv.Atoi(k); err == nil {
			ms[id] = v
		}
	}
	j.mu.Lock()
	already := j.finished
	j.finished = true
	j.mu.Unlock()
	if already {
		fail(w, http.StatusConflict, "job already finished")
		return
	}
	go a.builder.Run(j, ms)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *API) cancel(w http.ResponseWriter, _ *http.Request, j *Job) {
	log.Printf("job %s: cancelled", j.ID)
	a.store.Remove(j)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *API) status(w http.ResponseWriter, _ *http.Request, j *Job) {
	writeJSON(w, http.StatusOK, j.Status())
}

func (a *API) file(w http.ResponseWriter, r *http.Request, j *Job) {
	kind := r.URL.Query().Get("f")
	st := j.Status()
	name, ok := st.Files[kind]
	if !ok || st.State != "done" {
		fail(w, http.StatusNotFound, "no file")
		return
	}
	f, err := os.Open(filepath.Join(j.Dir, "out."+kind))
	if err != nil {
		fail(w, http.StatusNotFound, "no file")
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		fail(w, http.StatusInternalServerError, "no file")
		return
	}
	w.Header().Set("Content-Type", ctypes[kind])
	w.Header().Set("Content-Disposition", contentDisposition(name))
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "", fi.ModTime(), f)
}

// contentDisposition names the download: an ASCII fallback plus the UTF-8 name (RFC 6266).
func contentDisposition(name string) string {
	ascii := []rune{}
	for _, c := range name {
		switch {
		case c == '"' || c == '\\':
			ascii = append(ascii, '_')
		case c < 0x20 || c > 0x7e:
			ascii = append(ascii, '?')
		default:
			ascii = append(ascii, c)
		}
	}
	return mime.FormatMediaType("attachment", map[string]string{"filename": string(ascii)}) +
		"; filename*=UTF-8''" + percentEncode(name)
}

// percentEncode keeps only the unreserved characters of RFC 3986.
func percentEncode(s string) string {
	const hexd = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.' ||
			c == '_' || c == '~' {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hexd[c>>4])
			b.WriteByte(hexd[c&15])
		}
	}
	return b.String()
}

func (a *API) debugZip(w http.ResponseWriter, r *http.Request) {
	f, err := os.Create(filepath.Join(a.cfg.Data, "debug.zip"))
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close()
	n, err := io.Copy(f, http.MaxBytesReader(w, r.Body, 4<<30))
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"bytes": n})
}
