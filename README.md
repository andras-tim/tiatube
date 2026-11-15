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

## License

[GPL-3.0](LICENSE)
