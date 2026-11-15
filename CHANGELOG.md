# Change Log
All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).


## [Unreleased][unreleased]


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

[unreleased]: https://github.com/andras-tim/tiatube/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/andras-tim/tiatube/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/andras-tim/tiatube/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/andras-tim/tiatube/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/andras-tim/tiatube/compare/v1.0.0...v1.1.0
