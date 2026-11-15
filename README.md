# tiaTube

[![Releases](https://img.shields.io/github/release/andras-tim/tiatube.svg)](https://github.com/andras-tim/tiatube/releases)
[![Open issues](https://img.shields.io/github/issues/andras-tim/tiatube.svg)](https://github.com/andras-tim/tiatube/issues)
[![License](https://img.shields.io/badge/license-GPL%203.0-blue.svg)](https://github.com/andras-tim/tiatube/blob/master/LICENSE)

Save videos, music and photos from the page you are watching, in Hungarian.

> **Work in progress:** version 3 is being built on the `devel` branch. The last release of the old, server-side
> version is [v2.1.0](https://github.com/andras-tim/tiatube/tree/v2.1.0); it no longer works, because the video sites
> block downloads from servers.

## How it works

Version 3 lets the user's own browser do as much of the work as possible:

- a **bookmarklet** runs on the video page, finds the media and passes it to the tiaTube window;
- the **tiaTube window** asks what to save, shows the progress and saves the result;
- the **server** only muxes and transcodes with ffmpeg where a browser cannot do it well. It never downloads from a
  video site.

| | site | what |
|---|---|---|
| tiaWeb | any site with an HTML5 video | plain video files, straight from the site |
| tiaTube | YouTube | MP3, MKV, MP4 |
| tiaFace | Facebook | videos, reels, all photos and videos of a post in a ZIP |
| tiaVidea | videa.hu | every quality the player offers |

## Running it

tiaTube is one Docker image: a small Go server with ffmpeg. It needs a public HTTPS address (the bookmarklet runs on
HTTPS pages), so it goes behind a reverse proxy that terminates TLS.

1. Copy [compose.example.yml](compose.example.yml) to `compose.yml`, fill in the image version and the public URL.
2. `docker compose up -d`
3. Open the public URL and drag the tiaTube button to the bookmarks bar.

The server keeps nothing but the jobs in progress; finished files are deleted after a few hours.

| variable | default | |
|---|---|---|
| `TIATUBE_ORIGIN` | the address the browser used | the public URL, with its path when the proxy serves it under one |
| `TIATUBE_LISTEN` | `:8765` | |
| `TIATUBE_DATA` | `/data` | the jobs' files; emptied on start |
| `TIATUBE_MAX_FRAG` | `16MiB` | one uploaded piece |
| `TIATUBE_MAX_JOB` | `6GiB` | what one job may keep on disk |
| `TIATUBE_MAX_TOTAL` | `24GiB` | all jobs together; a new job starts only while a largest one still fits |
| `TIATUBE_JOB_TTL` | `6h` | how long a finished file is kept |
| `TIATUBE_IDLE_TIMEOUT` | `10m` | a job whose window is gone is dropped after this |
| `TIATUBE_REMUX_PARALLEL` | `2` | muxing jobs at a time; transcoding (MP3) runs one at a time |

## Development

Everything builds and runs in Docker through the `Makefile`; the CI runs the same targets.

| target | |
|---|---|
| `make test` | Go tests (with ffmpeg) |
| `make image` | the image `tiatube:dev` |
| `make run` | runs it on <http://127.0.0.1:8765/> |
| `make assets` | regenerates the logos and the background from `sites.json` and the old screenshot |
| `make ci` | what the CI runs |

## License

[GPL-3.0](LICENSE)
