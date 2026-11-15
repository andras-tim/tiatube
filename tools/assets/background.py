#!/usr/bin/env python3
"""The background of the install page: the old tiaTube page at a quarter size (8 KB, inlined). The page shows it at its
own width and blurs it in CSS, together with the strips around it, so the low resolution never shows.

usage: background.py SCREENSHOT OUT.webp
needs: Pillow
"""
import sys

from PIL import Image

WIDTH = 256  # the screenshot is 1024 px wide: a quarter of it


def main():
    src, out = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert('RGB')
    small = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    small.save(out, 'WEBP', quality=70, method=6)


if __name__ == '__main__':
    main()
