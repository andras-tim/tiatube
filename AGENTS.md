# tiaTube - agent instructions

## Repo overview

tiaTube saves videos, music and photos from the page the user is watching. Version 3 (in progress on `devel`) lets the
user's browser do as much of the work as possible: a bookmarklet finds the media, the tiaTube window saves it, and a
small server muxes and transcodes with ffmpeg only where a browser cannot. The plan with the reasoning:
`.claude/plans/2026-11-15-client-side-revamp.md`.

| path | what |
|---|---|
| `sites.json` | the sites: key, name, logo word, color, hosts |
| `poc/` | the working prototype; split into the components below step by step, then removed |
| `server/` | Go service (planned) |
| `web/bookmarklet/` | `core/` (tiaWeb) and `sites/` (planned) |
| `web/page/` | the tiaTube window (planned) |
| `web/install/` | install page over the blurred old page (planned) |
| `tools/logo/` | logo generator (Python, build time; its output is committed) |
| `screenshots/downloaded.png` | the old page; source of the install page background |

The UI is in Hungarian; everything else (code, comments, docs, commit messages) is in English.

## Architecture rules

### tiaWeb is the base, every site derives from it

- tiaWeb holds everything common: opening the window, the message protocol, flow control, chunked transfer, finding
  `<video>` elements, the item list and selection, file naming, saving.
- A site (tiaTube, tiaFace, tiaVidea) is a subclass of tiaWeb and overrides only what is specific to it. Something a
  site needs goes into tiaWeb when another site could use it, otherwise it stays in the site's class.
- The window follows the same split: a common UI and a small per-site part.
- A site's name, color, logo word and hosts live in `sites.json` only; everything else reads them from there.

### No duplication, in any language

- A rule lives in one place. File names are sanitized on the server only; the message protocol's names and limits are
  defined in one shared JS module.
- A value the server and the client must agree on (e.g. a size limit) comes from the server's API response; the
  client does not hardcode it.

### Transcoding

- A transcode option is never the default: the window marks it as slow and recommends the option without one.
- The server runs one transcode at a time and a few remuxes in parallel; a waiting job shows its queue position.

## Running

- Everything is built and run in Docker; nothing is installed on the developer's machine.
- The prototype: `python3 -I poc/server.py 8765`, then `http://127.0.0.1:8765/install`. Local use only.
- Testing a capture needs a real desktop Chrome with the bookmarklet, logged in where the site needs it; no headless
  browser.

## Public repository

This repository is public. No private data in any file, commit message, test fixture or screenshot: no host names of
a deployment, no personal accounts, no captured media or page data of real people, no cookies or tokens. The
deployment (host, domain, TLS, reverse proxy) lives outside this repository. Review the whole outgoing range before a
push.

## Commit conventions

See the `commit-messages` skill: `<area>: Subject`, brief bullet-list bodies, referencing the patch a fix regresses.
No `Co-Authored-By` or similar trailers. Commits and tags are signed (`commit.gpgsign`, `tag.gpgSign`).

`devel` is the working branch of version 3; `master` holds the releases. A release is an annotated tag with a bullet
changelog in its message and a GitHub release taken from it, only when the owner asks.

## Docs

A README states what is, this file and the skills state what to do. Plans (what will or might happen, with the
reasoning) live in `.claude/plans/YYYY-MM-DD-title.md` and stay after they are applied.

Knowledge about working in this repo (a correction, a "remember" / "emlékezz", a rule for runs, commits or docs) goes
into this file or the repo's `.claude/skills/` in the same turn, never into Claude's private memory: memory is not
versioned, and other sessions and agents do not see it.
