#!/bin/sh
# Builds the web files the server embeds: build-web.sh <out dir>. Runs in the Docker build (see Dockerfile).
set -eu
out=$1
root=$(cd "$(dirname "$0")/.." && pwd)
esbuild() { (cd "$root/tools" && go tool esbuild "$@"); }

mkdir -p "$out"
esbuild "$root/poc/bookmarklet.js" --minify --target=chrome110,firefox115,safari16 --charset=utf8 \
  --outfile="$out/bookmarklet.js" --log-level=warning
cp "$root/poc/page.html" "$out/index.html"
cp "$root/web/install/install.html" "$out/install.html"
