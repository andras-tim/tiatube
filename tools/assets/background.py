#!/usr/bin/env python3
"""The background of the install page: the old tiaTube page, shrunk and blurred once, here, so the browser only scales
a few KB up (which blurs it further) and never runs a blur filter.

usage: background.py SCREENSHOT OUT.webp
needs: Pillow
"""
import sys

from PIL import Image, ImageFilter

WIDTH = 256  # the screenshot is 1024 px wide: a quarter of it


def main():
    src, out = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert('RGB')
    small = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    small.filter(ImageFilter.GaussianBlur(1)).save(out, 'WEBP', quality=70, method=6)


if __name__ == '__main__':
    main()
