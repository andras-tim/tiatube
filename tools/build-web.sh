#!/bin/sh
# Builds the web files the server embeds: build-web.sh <out dir>. Runs in the Docker build (see Dockerfile).
# - bookmarklet.js: one script (the sites block foreign scripts, so it cannot load more)
# - index.html (the window), install.html: one file each, their script, style and the logos inlined
# - assets/logos/: the logos, as favicons
set -eu
out=$1
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

esbuild() {
  (cd "$root/tools" && go tool esbuild "$@" --bundle --minify --charset=utf8 --legal-comments=none \
    --target=chrome110,firefox115,safari16 --log-level=warning)
}

# inline <html> <placeholder> <file>...: the placeholder's place gets the files' content
inline() {
  html=$1 ph=$2
  shift 2
  cat "$@" > "$tmp/part"
  awk -v ph="$ph" -v f="$tmp/part" '
    i = index($0, ph) {
      printf "%s", substr($0, 1, i - 1)
      while ((getline l < f) > 0) print l
      close(f)
      print substr($0, i + length(ph))
      next
    }
    { print }' "$html" > "$tmp/html"
  mv "$tmp/html" "$html"
}

mkdir -p "$out"
esbuild "$root/web/bookmarklet/main.js" --format=iife --outfile="$out/bookmarklet.js"

# the logos as hidden symbols
sed 's#^<svg xmlns="http://www.w3.org/2000/svg">#<svg width="0" height="0" style="position:absolute" aria-hidden="true">#' \
  "$root/assets/logos/logos.svg" > "$tmp/logos.svg"

esbuild "$root/web/page/head.js" --format=iife --outfile="$tmp/head.js"
esbuild "$root/web/page/main.js" --format=iife --outfile="$tmp/main.js"
esbuild "$root/web/page/style.css" --outfile="$tmp/style.css"
cp "$root/web/page/index.html" "$out/index.html"
inline "$out/index.html" '/*HEAD*/' "$tmp/head.js"
inline "$out/index.html" '/*CSS*/' "$tmp/style.css"
inline "$out/index.html" '<!--LOGOS-->' "$tmp/logos.svg"
inline "$out/index.html" '/*SCRIPT*/' "$tmp/main.js"

esbuild "$root/web/install/main.js" --format=iife --outfile="$tmp/install.js"
esbuild "$root/web/install/style.css" --loader:.webp=dataurl --outfile="$tmp/install.css"
cp "$root/web/install/index.html" "$out/install.html"
inline "$out/install.html" '/*HEAD*/' "$tmp/head.js"
inline "$out/install.html" '/*CSS*/' "$tmp/install.css"
inline "$out/install.html" '<!--LOGOS-->' "$tmp/logos.svg"
inline "$out/install.html" '/*SCRIPT*/' "$tmp/install.js"

# the favicons
mkdir -p "$out/assets/logos"
cp "$root/assets/logos/"tia*.svg "$out/assets/logos/"
