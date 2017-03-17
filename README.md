# ![Logo](www/ico/apple-touch-icon-57-precomposed.png) tiaTube
[![Releases](https://img.shields.io/github/release/andras-tim/tiatube.svg)](https://github.com/andras-tim/tiatube/releases)
[![Open issues](https://img.shields.io/github/issues/andras-tim/tiatube.svg)](https://github.com/andras-tim/tiatube/issues)
[![License](https://img.shields.io/badge/license-GPL%203.0-blue.svg)](https://github.com/andras-tim/tiatube/blob/master/LICENSE)

This is a minimal ``youtube-dl`` frontend in Hungarian language.

- Download YouTube video in the best quality and extract/convert audio in MP3 format
- Getting video info for proper filename
- Getting thumbnail for ID3 album art
- Session based download cache


## Setup
1. Download source to ``/opt/tiatube`` directory.
2. Run ``install.sh``
3. Check UI config file ``www/js/config.js``
4. Share ``/opt/tiatube/www`` directory with PHP supported web server (e.g. **apache2**)


## Screenshots
* Main page<br/> ![Main page](screenshots/main.png)
* Download finished<br/> ![Download finished](screenshots/downloaded.png)
