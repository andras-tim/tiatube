# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).


## [Unreleased][unreleased]


## [3.1.2] - 2026-11-25
### Fixed
- A Facebook photo clicked in a feed saved the post behind it, with that post's text; it saves the clicked photo's own
  post now, a group's post too, and a photo outside a post alone (bookmarklet 4)
- A Facebook reel scrolled to in the reel viewer was taken for an unrelated post; it reads its own tracks now
  (bookmarklet 3)

### Changed
- The link to the install page closes the window of an outdated bookmarklet, unless a save is running


## [3.1.1] - 2026-11-23
### Fixed
- A Facebook video without a title in the page's data was named after the browser tab ("Videó"); it is named after
  the text shown under it now (bookmarklet 2: a v1 bookmarklet gets the note about the newer one)


## [3.1.0] - 2026-11-22
### Added
- Numbered bookmarklets: the install page names the button "tiaTube v1", the window shows which one opened it and
  whether it is the latest, also on a page without a video
- Self-check: the window tells when the bookmarklet does not answer, a run fails or stalls, and what to do (a new
  bookmarklet or a reload); the bookmarklet shows a box with a link to a new one when it fails on the page
- The best format the user's session offers, also when an extension (e.g. h264ify) hides codecs from the page; the
  window shows which audio and video came, and warns when a better audio was offered
- The fragment being collected and uploaded under the bars; the item in work in a playlist or a post
- The window's logo opens the install page
- A smoke test checklist for fixes and releases

### Fixed
- A second run on the same YouTube page, or on the next video without a reload, captured nothing
- The last part of a capture could be lost when it was not cached (a 4K video)
- An incomplete file told what it lacks as JSON; a spinner stayed after a cancel; two boxes on the page
- The option picker used smaller text than the result


## [3.0.1] - 2026-11-20
### Fixed
- The window waited for the video forever when the server is served under a path (`TIATUBE_ORIGIN` with a path):
  the bookmarklet dropped its messages; a bookmarklet dragged before needs to be dragged again


## [3.0.0] - 2026-11-16
### Added
- Client-side capture: a bookmarklet runs on the video page and opens the tiaTube window
- Sites: YouTube (tiaTube), Facebook videos, reels and posts (tiaFace), videa.hu (tiaVidea), a plain video file on
  any page (tiaWeb); when a site's class finds nothing, tiaWeb looks for any video on the page
- YouTube playlists: the window offers the items, several of them go one after the other into a ZIP
- Facebook posts: the photos and videos in one ZIP, with EXIF and XMP in the photos
- A Go server that muxes with ffmpeg: a queue for audio encoding (one at a time) and one for muxing, size limits,
  cancel, idle timeout, a cover image from an allowlist of image hosts
- The window tells an outdated bookmarklet: a note for an older build, a refusal for another protocol
- The server refuses POSTs that other sites' pages send through their visitors' browsers
- An install page, the logos rendered from `sites.json`, a Docker image, a compose example, a Makefile and GitHub CI

### Removed
- The server-side downloader (PHP, youtube-dl): the video sites block downloads from servers


## [2.1.0] - 2022-05-25
### Added
- Parallel downloading

### Changed
- Replaced video container from MP4 to MKV (MP4 was too strict and can not be contain WEBM)

### Fixed
- Small code fixes
- Fixed process management


## [2.0.0] - 2017-03-17
### Added
- Able to download audio and video content too

### Changed
- Updated license to GPLv3

### Fixed
- Fixed PHP7 background process starting issue


## [1.1.0] - 2017-03-16
### Added
- Auto focus on video ID field

### Changed
- More fancy and responsive download status
- Updated external libs, and used CDN where is possible
- Improved download cache handling

### Fixed
- Show proper message when error occurs


## 1.0.0 - 2015-10-17
### Added
- Download YouTube video in the best quality and extract/convert audio in MP3 format
- Getting video info for proper filename
- Getting thumbnail for ID3 album art
- Session based download cache

[unreleased]: https://github.com/andras-tim/tiatube/compare/v3.1.2...HEAD
[3.1.2]: https://github.com/andras-tim/tiatube/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/andras-tim/tiatube/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/andras-tim/tiatube/compare/v3.0.1...v3.1.0
[3.0.1]: https://github.com/andras-tim/tiatube/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/andras-tim/tiatube/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/andras-tim/tiatube/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/andras-tim/tiatube/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/andras-tim/tiatube/compare/v1.0.0...v1.1.0
