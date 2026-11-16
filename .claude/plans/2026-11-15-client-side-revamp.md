# tiaTube 3: client-side capture

Status: approved 2026-11-15; milestones 1-6 done (see Progress), 7 waits for the owner. Milestones run in order. Each ends with a commit; nothing is pushed until the owner
asks for it.

## Goal

The old tiaTube (2015-2022: PHP + youtube-dl on the server) stopped working because the video sites block downloads
from servers. Version 3 turns this around: **the user's own browser does as much of the work as possible.**

- A **bookmarklet** runs on the video page. It finds the media and passes it to the tiaTube window.
- The **tiaTube window** (a popup from the tiaTube origin) asks what to save, shows progress and saves the result.
- The **backend** only does what a browser cannot do well: muxing and transcoding with ffmpeg. It never talks to a
  video site, except to fetch a public preview image from an allowlisted host.

A proof of concept (PoC) already works end to end for every site below. This plan turns it into a maintained product
in this repository.

## Sites ("products")

| name | site | how | server needed |
|---|---|---|---|
| tiaWeb | any site with an HTML5 video | lists the page's videos; a plain video file streams from the site into the window's file | no |
| tiaTube | YouTube | hooks Media Source Extensions, replays the video from 0 at 16x, muted; uploads the fragments | yes (mux, MP3) |
| tiaFace | Facebook video / reel | fetches the complete DASH tracks the page lists, no playback | yes (mux; H.264 transcode on request) |
| tiaFace | Facebook post | fetches every photo and video of the post; the window builds a ZIP with EXIF + XMP metadata | no |
| tiaVidea | videa.hu | the player's own source list: every quality, signed URLs | no |

On a page with nothing to capture, the window shows a short description of what tiaTube supports and its main idea:
the most possible work in the browser.

## Architecture rules (they go into AGENTS.md)

### tiaWeb is the base, every site derives from it

- **tiaWeb holds everything common**: opening the window, the message protocol, flow control, chunked transfer,
  finding `<video>` elements (also in same-origin iframes), the item list and selection, file naming, saving.
- **A site (tiaTube, tiaFace, tiaVidea) is a subclass of tiaWeb** and overrides only what is specific to it (how media
  is found, how it is fetched). When a site needs something tiaWeb does not have, it is added to tiaWeb if another site
  could use it, otherwise it stays in the site's class.
- The same split applies to the window: a common UI, plus a small per-site part (options, notes).
- **One site table** (`sites.json`: key, display name, color, logo) feeds the logo generator, the window's CSS tokens
  and the install page. A site's color or name is never written anywhere else.

### No duplication across languages either

- A rule lives in **one** place. Examples: file name sanitizing happens on the server only (the window sends the raw
  title); the message protocol's names and limits are defined in one shared JS module that both the bookmarklet and the
  window import.
- When the server and the window must agree on a value (e.g. the fragment size limit), the server announces it in its
  API response, the client does not hardcode it.

### Public repository

- No private data in any file, commit message, test fixture or screenshot: no host names of the deployment, no
  personal accounts, no captured media of real people, no cookies or tokens.
- The deployment (host, domain, TLS, reverse proxy) lives outside this repo. This repo ships a Docker image and a
  generic compose example with placeholders.

## Components

### Bookmarklet

- Source: ES modules under `web/bookmarklet/`: `core/` (tiaWeb) and `sites/<site>.js` (subclasses).
- YouTube and Facebook block foreign scripts with CSP, so the bookmarklet cannot load code from the tiaTube origin: it
  must be **one self-contained `javascript:` URL**. esbuild bundles and minifies the modules into one IIFE (the PoC's
  unminified bookmarklet is 35 KB).
- The tiaTube origin is filled in when the install page is served (as in the PoC), so one build serves any deployment.

### tiaTube window

- Source: `web/page/` (HTML, CSS, JS modules), bundled by esbuild into one page.
- Kept from the PoC as is: the design (layout, status list, cards, segmented buttons, file name box), auto-download with
  a muted "download again" link, the top 3 quality levels, the browser-built ZIP (stored, UTF-8 names, UT extra field;
  ZIP64 is not implemented, so the limit is 4 GB), EXIF + XMP in the JPEGs of a Facebook post, `showSaveFilePicker`
  with a Blob fallback.
- Kept: on YouTube above 1080p, MP4 stays disabled (YouTube has H.264 up to 1080p only, and there is no video
  transcode, see Decisions 2026-11-16); MKV is the choice there.

### Facebook video quality

The best quality is the default: the HD track, which is AV1 (smaller and sharper than the H.264 SD track). For older
devices the window offers the SD track (H.264). A transcode of the HD track to H.264 is deferred (Decisions 2026-11-16).

### Playlist selection (new)

On YouTube and videa, when a playlist is open, the window offers its items with a checkbox list, as tiaWeb already does
for a page with several videos. The selected items are processed one after the other.

- YouTube: research first. The likely way is the player API (`playVideoAt`/`loadVideoById`) in the same tab, so the page
  is not reloaded and the MSE hooks stay. Each item still plays at 16x, so a playlist takes about duration / 16.
- videa: research first: whether the source list of another item can be fetched from the page (the player's own XML
  request) without opening it.

### Backend (Go)

Go, standard library only. Why Go: the work is I/O and process control (ffmpeg does the heavy part), goroutines
handle many parallel uploads with little memory, `exec.CommandContext` stops ffmpeg when a job is cancelled, and the Go 1
compatibility promise keeps a stdlib-only service building for years. The planned Go / Rust / Python comparison is
dropped: it would only measure ffmpeg.

API: the PoC's (`/api/job`, `/api/frag`, `/api/finish`, `/api/status`, `/api/file`), plus:

- **Two queues**:
  - transcode (audio only: MP3, and AAC for an MP4 whose audio is not AAC): 1 at a time;
  - remux (`-c copy`, MKV/MP4/M4A/Opus): a few at a time (configurable, default 2).

  A waiting job reports its position ("Sorban: 2."), the window shows it.
- **Cancel**: an explicit cancel call, and an idle timeout for jobs whose window disappeared; both kill a running ffmpeg
  and delete the job's files.
- **Limits**: max fragment size, max job size, max parallel jobs being received, max total temp bytes (a new job is
  refused with a clear message when it would not fit), job TTL with a cleanup loop. Defaults:
  - max job size: 6 GiB. A 2-hour video can be a 2 GB file, and a job holds the received tracks, the output and, with
    a transcode, the transcoded output too;
  - total temp space: a setting of the deployment; the compose example uses 24 GiB (4 jobs: 1 transcode, 2 remux,
    1 being received);
  - job TTL: 6 hours after the job is done.
- **H.264 transcode, deferred (Decisions 2026-11-16)**: `libx264` for an MP4 that plays everywhere. It is slow: a 2-hour 1080p video can take hours on a
  small server CPU, so the preset and quality are chosen by measurement in milestone 3, and the window shows the queue
  position and an estimate of the remaining time.
- **A transcode option is never the default**: the window marks every option that needs a transcode as slow, and
  recommends the option without one.
- **Files are streamed** to the client (`http.ServeContent`), never read into memory (the PoC reads them whole).
- **Preview image fetch with a host allowlist** (YouTube and Facebook image CDNs), size and type checked, to rule out
  SSRF.
- Unit tests for fragment assembly (format choice, gap detection, completeness) and for the queues.

### Install page with the old page in the background

- The old tiaTube page stays as a memory: `screenshots/downloaded.png` (the finished-download state, so it fills the
  screen) is shrunk to 256 px wide and blurred once, at build time (WebP, about 3 KB). The browser scales it up, which
  blurs it further, so no runtime `filter: blur()` is needed.
- Placed at its original 1024 CSS px width, centered, `fixed`; the sides are filled by a CSS gradient that continues
  the screenshot's edges (a 50 px #222 navbar strip, white below), just as the original page centered its content.
- A grey semi-transparent layer covers it; in front of it, a window with the install content (the bookmarklet to drag
  to the bookmarks bar, a short guide, the supported sites).
- Plain HTML + CSS, no framework: nothing to break as browsers move on, nothing to load beyond a few KB.

### Logos

- Every logo is a compact rendered SVG: text converted to paths by the generator (`tools/logo/`, Python + fontTools,
  build time only; its output is committed).
- New: **tiaVidea**. Its color is the median color of the videa logo's non-background pixels (computed once, the value
  goes into `sites.json`).

### Build and Docker

- Nothing is installed on the developer's machine: every build runs in Docker.
- Multi-stage `Dockerfile`:
  1. Go toolchain: esbuild (a Go program, run with `go run`, so no Node.js) bundles the bookmarklet and the window; the
     Go service is built as a static binary.
  2. Runtime: a slim base image with ffmpeg and the binary; runs as a non-root user, read-only root filesystem, the job
     data in a volume (or tmpfs), a health check endpoint.
- `compose.example.yml` with placeholders (origin URL, limits, data path).

## Repository layout after the cleanup

```
AGENTS.md  README.md  CHANGELOG.md  LICENSE
Dockerfile  compose.example.yml
sites.json
server/            Go service
web/bookmarklet/   core/ (tiaWeb) + sites/
web/page/          the tiaTube window
web/install/       install page (background + install window)
tools/logo/        logo generator (Python, build time)
assets/            generated logos, the blurred background
screenshots/       downloaded.png stays (source of the background); main.png goes
.claude/plans/     this plan
```

Removed: `www/` (PHP, jQuery, Bower vendor files), `tiatube.sh`, `install.sh`, `bower.json`, `.bowerrc`, the old
screenshots except `downloaded.png`. Git history and the old tags stay; the old version remains reachable at `v2.1.0`.

## Milestones

1. **Secure the PoC and clean the repo**
   - Copy the PoC sources (bookmarklet, window, server, logo generator) into the work branch, outside the final
     layout, so they no longer live only in a temporary directory. Test helpers with captured page data stay out.
   - Remove the old files, add AGENTS.md (the rules above), new README skeleton, `sites.json`.
2. **Go backend, Makefile, Docker, CI**
   - Port of the PoC server with the queues, cancel, limits, streaming, allowlist; tests. The PoC Python server is
     deleted at the end of this milestone.
   - The Makefile is the one interface for building, testing and running, locally and in GitHub CI.
3. **Bundled frontend, same behavior as the PoC**
   - Split the bookmarklet into tiaWeb core + site subclasses, the window into common + per-site parts, esbuild in
     Docker. No new features: every PoC flow must work the same (test matrix below).
4. **Install page and logos**
   - Background, overlay, install window; logo generator in `tools/logo/`; tiaVidea logo and color.
5. **Docker image**
   - Compose example, README setup section (the image itself comes with milestone 2).
6. **Playlist selection**
   - YouTube and videa: research, then implementation in the site subclasses (selection UI from tiaWeb).
7. **Release 3.0.0**
   - CHANGELOG, README screenshots of the new window, tag. The deployment is a separate task outside this repo.

### Test matrix (end of milestones 2, 3, 5, 6)

In a real desktop Chrome, logged in where the site needs it:

- YouTube: video as MP3, as MKV, as MP4 (≤ 1080p remux; above 1080p MP4 is disabled); a Shorts page.
- Facebook: a video as HD (AV1) and as SD (H.264), a reel, a post with several photos and a video (ZIP: names, EXIF, XMP).
- tiaWeb: a page with one plain video file; a page with several videos.
- videa: each quality of one video.
- An unsupported page: the info window.
- Two jobs in parallel from two windows: the second one waits in the transcode queue and shows its position.

## Progress

- 2026-11-15, milestones 1-6 done on `devel` and tested in Chrome with the test matrix (YouTube MP3, MKV, a playlist
  of two into a ZIP, cancel; Facebook video and post ZIP; videa sizes and cancel; a plain HTML5 video; an unsupported
  page). Not pushed.
- Order as done: 1, 2 (Go backend, Makefile, Docker, CI), 3 (frontend split), 4 (logos, background, install page),
  5 (compose example, README), 6 (playlists).
- 2026-11-16, milestone 7: the owner tested the install page and the window; reworded texts, logo boxes that fit their
  word, the bookmarklet version check, the tiaWeb fallback, the cross-origin protection of the API; released 3.0.0.
- Findings:
  - Chrome starts only the first automatic download of a window; the bookmarklet reuses its window by name, so a
    second run in the same window shows the "újra letöltés" link instead. Playlists avoid it with one ZIP.
  - videa.hu has no public playlists (no playlist pages or links found, a web search neither), so tiaVidea has no
    playlist choice.
  - No video transcode was built: it is deferred (Decisions 2026-11-16).

## Decisions

- 2026-11-15, branch: `devel` was reset to `master` and v3 is built on it; the release merges `devel` into `master`.
  The old `devel` tip (`bc1907f`, an unfinished 2017 PHP Dockerfile) is not part of v3.
- 2026-11-15, Facebook video: HD (AV1) by default, H.264 by transcode on request.
- 2026-11-15, limits: 6 GiB max job size, TTL 6 hours after done; the total temp space is set per deployment.
- 2026-11-15, YouTube MP4 above 1080p: offered through the H.264 transcode, marked as slow; MKV (no transcode) is the
  recommended choice there.
- 2026-11-15, order: the Go backend came before the frontend split. It was tested end to end with the prototype
  window, so the split is tested once, against the final server.
- 2026-11-15, the Makefile is the one interface for building, testing and running (owner's request); GitHub CI runs
  the same targets.
- 2026-11-15, the server sends status codes, no UI text; the window owns every Hungarian string.
- 2026-11-15, preview image: the client sends candidates, best first (YouTube has no `maxresdefault` for old
  videos); the server takes the first one an allowlisted host serves.
- 2026-11-16, no video transcode for now (owner's decision); it supersedes the two 2026-11-15 decisions on the
  Facebook H.264 transcode and the YouTube MP4 above 1080p. The server re-encodes audio only (MP3, AAC). The UI
  proposal for a later round, so it is not designed again:
  - one rule on every site: MP4 = H.264 (copied when the source is H.264, else transcoded, slow), MKV = the original
    codec, never transcoded; the window tells slow from the codec of the chosen quality, so `mp4Max` goes;
  - a slow MP4 gets a "lassú" tag and MKV "ajánlott", MKV is then the default, and a warning explains the choice;
  - the run shows the queue position and an "Újrakódolás H.264-re" step with a remaining time from the measured ffmpeg
    speed; no estimate before the start (the server CPU differs per deployment);
  - open then: whether Facebook HD becomes MKV by default, and whether a slow choice asks for a confirmation.

- 2026-11-16, an outdated bookmarklet: the window compares the bookmarklet's build (a hash of its source) and
  `PROTOCOL`; another build gets a note, another protocol is refused. No loader bookmarklet: YouTube's Trusted Types and
  Facebook's CSP block a script loaded from another origin.
- 2026-11-16, who may use a server: the API refuses cross-site POSTs (`http.CrossOriginProtection`); limiting the users
  is the reverse proxy's authentication, outside this repository.

## Open questions

1. **Later, not in this plan**: a video transcode (see Decisions 2026-11-16).
2. **Later, not in this plan**: HLS/DASH streams in tiaWeb (today only plain files), more sites.
