---
name: smoke-test
description: The smoke test of tiaTube - the item by item check after a fix and before a release, so a change does not break another flow. Runs the image behind a path prefix (as a real deployment does) in test mode, drives a desktop Chrome over CDP, and walks through the bookmarklet and window checks, every YouTube mode, Facebook, videa and plain HTML5 video. Use this whenever a fix or a feature is done, before a release, or when asked for a regression check. Trigger on: smoke test, regression, before release, check everything, test all sites, végigtesztel.
---

# smoke-test - what to check after a fix

Run it after every fix and before every release. A fix often breaks a flow it does not touch (2026-11-22: the
capture of a non-cached 4K video lost its last part, an older bug no single test had shown). Report the result as a
table: item, result, and for a failure what came instead.

## Setup

1. `make ci` is green.
2. `make image`, then the image in test mode behind a path, as a deployment serves it (3.0.0 broke only there):

   ```sh
   docker run -d --rm --name tiatube-dev --init --read-only -p 127.0.0.1:8765:8765 -v tiatube-data:/data \
     -e TIATUBE_TEST=1 -e TIATUBE_ORIGIN=http://127.0.0.1:8766/tiatube tiatube:dev
   ```

   and an nginx in front of it (`--network host`, its config mounted at `/etc/nginx/nginx.conf`):

   ```nginx
   events {}
   http {
     client_max_body_size 64m;
     server {
       listen 127.0.0.1:8766;
       location = /tiatube { return 301 /tiatube/; }
       location /tiatube/ { proxy_pass http://127.0.0.1:8765/; proxy_request_buffering off; proxy_set_header Host $host; }
     }
   }
   ```

3. A desktop Chrome logged in to YouTube and Facebook, driven over CDP (`Runtime.evaluate`), in a window of its own.
4. The bookmarklet runs through the test loader (see AGENTS.md, Running): on the page, `Page.setBypassCSP` and a
   reload, a `message` listener that evaluates `e.data.ttTestCode`, then
   `window.open('http://127.0.0.1:8766/tiatube/api/test/loader', 'tiatube', 'width=520,height=440')` with a user gesture
   (`userGesture: true`, and not after a timeout: the gesture expires). The bookmarklet reuses that window.
5. Test mode sends a file built in the window (ZIP, plain file) to the server; a file the server built is downloaded
   by a link click, so stub `HTMLAnchorElement.prototype.click` in the window before the start to keep the Downloads
   folder clean.
6. To make the bookmarklet fail on purpose, change the loader's code before the evaluation (e.g. replace
   `new URL(this.TT).origin` with another origin: it can no longer hear the window; or make
   `Document.prototype.querySelectorAll` throw around it: it fails before the window opens).

## Test material

No video ids or pages of real people in this repository: pick them at run time.

- YouTube: a short 4K video not opened before in this browser (not cached), a 1-2 minute video, a Short, a playlist of
  short items, a page with a related short video for a move without a reload.
- Facebook: a public page's video, a reel, a post with a video and one with photos.
- videa.hu: a short video.
- A page with a plain HTML5 `<video>`, and a page without a video.

## Checklist

| # | case | expected |
|---|---|---|
| **Bookmarklet and window** | | |
| 1 | install page | button "tiaTube v<number>", the line about the older bookmarks, a click on the button warns |
| 2 | current bookmarklet on a video | the title arrives; "Könyvjelző: tiaTube v<n>, a legfrissebb"; no warning after 10 s |
| 3 | current bookmarklet on a page without a video | the info view with the number |
| 4 | old bookmarklet (`window?s=tube&v=<hash>&p=1`, no answer) | "régi tiaTube, elavult", the update note; after 10 s "A videó oldala nem válaszol" with links to the install page |
| 5 | the bookmarklet cannot hear the window | after 10 s the page's box with a link; the window: "nem válaszol", reload advice |
| 6 | the bookmarklet fails before the window | the box with the error and the link, one box on the page, no popup |
| 7 | blocked popup | the alert to allow popups |
| 8 | the window's logo | a link to the install page, new tab |
| 9 | served under a path | 2 works with the path in every link and message |
| **YouTube** | | |
| 10 | MP3 | complete; the fragment count under the capture and the upload ("3. töredék"); the formats box "Hang: Opus …, a legjobb elérhető" above "Kész, teljes." |
| 11 | original audio | the extension follows the codec (`.opus` / `.m4a`) |
| 12 | MKV at the top level, not cached | the chosen resolution, the best audio, complete on the first run |
| 13 | MP4 1080p | H.264 with the best AAC |
| 14 | a second run on the same page, no reload | captures again |
| 15 | another video on the same page, no reload, then a run | captures it; the date prefix is its own |
| 16 | playlist, 2 items | a ZIP of 2 files; "Videók (1 / 2)" while the first one runs |
| 17 | a Short | complete; the video labelled as the site does (720p, not 1280p) |
| 18 | cancel during a capture; close the window during a capture | the server drops the job; the page plays as before, paused; no spinner left; no advice after a cancel |
| 19 | an extension that hides codecs (e.g. h264ify) | the best format still comes; after the run the page's codec answers are as before |
| 20 | incomplete file (when one occurs; it cannot be forced) | "Kész, de HIÁNYOS:" with what is missing in words |
| **Other sites** | | |
| 21 | Facebook video, reel, post with a video, post with photos | complete; a ZIP for a post |
| 22 | videa | the sizes, one download |
| 23 | plain HTML5 video; page without a video | "Kész, teljes: <size>"; the info view |
| **After a release** | | |
| 24 | the deployment | the install page shows the new number; 2 and 10 there |

## Known traps

- A short video uploads in a moment: sample the counts every 100-150 ms to see them.
- `Page.setBypassCSP` may be lost after a navigation: set it again and reload before the loader.
- A capture in a background window is slow (16x speed is not reached); use short videos, or a focused window.
- A popup takes the focus: tell the user before the run.
