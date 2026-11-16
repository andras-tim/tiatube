package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config comes from TIATUBE_* environment variables; every field has a default.
type Config struct {
	Listen        string        // TIATUBE_LISTEN
	Data          string        // TIATUBE_DATA: job directories; wiped on start
	Origin        string        // TIATUBE_ORIGIN: public URL baked into the bookmarklet; empty: taken from the request
	WebDir        string        // TIATUBE_WEB_DIR: serve the web files from disk instead of the embedded ones
	MaxFrag       int64         // TIATUBE_MAX_FRAG: one uploaded fragment
	MaxJob        int64         // TIATUBE_MAX_JOB: everything a job keeps on disk
	MaxTotal      int64         // TIATUBE_MAX_TOTAL: all jobs together
	JobTTL        time.Duration // TIATUBE_JOB_TTL: a finished job is kept this long
	IdleTimeout   time.Duration // TIATUBE_IDLE_TIMEOUT: a receiving job without a request this long is dropped
	RemuxParallel int           // TIATUBE_REMUX_PARALLEL: remux jobs at a time; transcodes run one at a time
	Test          bool          // TIATUBE_TEST: enables the test upload endpoint
}

func loadConfig(env func(string) string) (Config, error) {
	c := Config{
		Listen:        ":8765",
		Data:          "/data",
		MaxFrag:       16 << 20,
		MaxJob:        6 << 30,
		MaxTotal:      24 << 30,
		JobTTL:        6 * time.Hour,
		IdleTimeout:   10 * time.Minute,
		RemuxParallel: 2,
	}
	var errs []string
	str := func(name string, dst *string) {
		if v := env(name); v != "" {
			*dst = v
		}
	}
	size := func(name string, dst *int64) {
		if v := env(name); v != "" {
			n, err := parseSize(v)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: %v", name, err))
			}
			*dst = n
		}
	}
	dur := func(name string, dst *time.Duration) {
		if v := env(name); v != "" {
			d, err := time.ParseDuration(v)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: %v", name, err))
			}
			*dst = d
		}
	}
	str("TIATUBE_LISTEN", &c.Listen)
	str("TIATUBE_DATA", &c.Data)
	str("TIATUBE_ORIGIN", &c.Origin)
	str("TIATUBE_WEB_DIR", &c.WebDir)
	size("TIATUBE_MAX_FRAG", &c.MaxFrag)
	size("TIATUBE_MAX_JOB", &c.MaxJob)
	size("TIATUBE_MAX_TOTAL", &c.MaxTotal)
	dur("TIATUBE_JOB_TTL", &c.JobTTL)
	dur("TIATUBE_IDLE_TIMEOUT", &c.IdleTimeout)
	if v := env("TIATUBE_REMUX_PARALLEL"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			errs = append(errs, "TIATUBE_REMUX_PARALLEL: a positive integer is needed")
		}
		c.RemuxParallel = n
	}
	c.Test = env("TIATUBE_TEST") == "1"
	c.Origin = strings.TrimRight(c.Origin, "/")
	if c.MaxJob > c.MaxTotal {
		errs = append(errs, "TIATUBE_MAX_JOB is larger than TIATUBE_MAX_TOTAL")
	}
	if len(errs) > 0 {
		return c, fmt.Errorf("config: %s", strings.Join(errs, "; "))
	}
	return c, nil
}

// parseSize reads a byte count: plain, or with a KiB/MiB/GiB/TiB suffix.
func parseSize(s string) (int64, error) {
	units := []struct {
		suffix string
		mul    int64
	}{{"TiB", 1 << 40}, {"GiB", 1 << 30}, {"MiB", 1 << 20}, {"KiB", 1 << 10}, {"B", 1}}
	mul := int64(1)
	for _, u := range units {
		if strings.HasSuffix(s, u.suffix) {
			s, mul = strings.TrimSpace(strings.TrimSuffix(s, u.suffix)), u.mul
			break
		}
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("not a size: %q", s)
	}
	return n * mul, nil
}

func getenv() func(string) string { return os.Getenv }
