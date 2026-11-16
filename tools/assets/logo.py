#!/usr/bin/env python3
"""tiaTube logo generator: one SVG per site of sites.json, the letters as outlines, so no font is needed to show it.
It also writes logos.svg, the same logos as <symbol> elements, for pages that inline them.

Every element is placed by its drawn outline (ink), not by font metrics: the "tia" and the word are centred
horizontally, the white box is the word's ink with a margin around it (the same on the left and right, a little more
than above and below), and the whole white block is centred vertically.

usage: logo.py --sites sites.json --fonts DIR --out DIR
needs: fonttools, uharfbuzz; fonts: JetBrains Mono ExtraBold, Oswald SemiBold
"""
import argparse
import json
import os

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# geometry, in units of the 100x100 view box
SHAPE_RADIUS = 24          # rounded top-left and bottom-right corners
TIA = dict(font='JetBrainsMono-ExtraBold.ttf', size=26.1, spacing=-0.7)
BOX = dict(margin_x=8, margin_y=5.85, radius=6)
GAP = 4.8                  # between the bottom of "tia" and the top of the box
WORD = dict(font='Oswald-SemiBold.ttf', size=26.5)


def fmt(v):
    """One decimal: a tenth of a unit is a thousandth of the logo."""
    s = f'{v:.1f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.glyphs = self.tt.getGlyphSet()
        self.upem = self.tt['head'].unitsPerEm
        with open(path, 'rb') as f:
            self.hb_font = hb.Font(hb.Face(f.read()))

    def shape(self, text):
        """[(glyph name, x advance, x offset)] in font units, kerning applied."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {'kern': True, 'liga': False})
        order = self.tt.getGlyphOrder()
        return [(order[i.codepoint], p.x_advance, p.x_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def run(font, text, size, spacing=0.0, width=None):
    """Lay out one line at origin (0, baseline 0), y pointing down.
    Returns (path data, ink bounds (x0, y0, x1, y1)) in view box units."""
    s = size / font.upem
    glyphs = font.shape(text)
    advance = sum(a for _, a, _ in glyphs) * s + spacing * (len(glyphs) - 1)
    sx = width / advance if width else 1.0      # like SVG textLength with lengthAdjust="spacingAndGlyphs"
    # the glyph set resolves composite glyphs (e.g. the dot of the i)
    pen, bounds = SVGPathPen(font.glyphs, ntos=fmt), BoundsPen(font.glyphs)
    x = 0.0
    for name, adv, off in glyphs:
        t = (s * sx, 0, 0, -s, x + off * s * sx, 0)
        font.glyphs[name].draw(TransformPen(pen, t))
        font.glyphs[name].draw(TransformPen(bounds, t))
        x += (adv * s + spacing) * sx
    return pen.getCommands(), bounds.bounds


def body(fonts, site):
    """The logo's elements; the ink of "tia" and of the word is moved to its place."""
    tia_d, tia_b = run(fonts['tia'], 'tia', TIA['size'], TIA['spacing'])
    word_d, word_b = run(fonts['word'], site['word'], WORD['size'], width=site.get('logoWordWidth'))
    tia_h = tia_b[3] - tia_b[1]
    mx, my = BOX['margin_x'], BOX['margin_y']
    bw, bh = word_b[2] - word_b[0] + 2 * mx, word_b[3] - word_b[1] + 2 * my
    top = 50 - (tia_h + GAP + bh) / 2
    bx, by = 50 - bw / 2, top + tia_h + GAP
    tx, ty = 50 - (tia_b[0] + tia_b[2]) / 2, top - tia_b[1]
    wx, wy = bx + mx - word_b[0], by + my - word_b[1]
    r, c = SHAPE_RADIUS, site['color']
    return (f'<path d="M{r} 0H100V{100 - r}A{r} {r} 0 0 1 {100 - r} 100H0V{r}A{r} {r} 0 0 1 {r} 0Z" fill="{c}"/>'
            f'<path transform="translate({fmt(tx)} {fmt(ty)})" d="{tia_d}" fill="#fff"/>'
            f'<rect x="{fmt(bx)}" y="{fmt(by)}" width="{fmt(bw)}" height="{fmt(bh)}" rx="{BOX["radius"]}"'
            f' fill="#fff"/>'
            f'<path transform="translate({fmt(wx)} {fmt(wy)})" d="{word_d}" fill="{c}"/>')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sites', required=True)
    ap.add_argument('--fonts', required=True, help='directory with the two TTF files')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    with open(a.sites, encoding='utf-8') as f:
        sites = json.load(f)
    fonts = {'tia': Font(os.path.join(a.fonts, TIA['font'])), 'word': Font(os.path.join(a.fonts, WORD['font']))}
    os.makedirs(a.out, exist_ok=True)
    symbols = []
    for key, site in sites.items():
        b = body(fonts, site)
        name = f'tia{key}'
        with open(os.path.join(a.out, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{b}</svg>\n')
        symbols.append(f'<symbol id="logo-{name}" viewBox="0 0 100 100">{b}</symbol>')
    with open(os.path.join(a.out, 'logos.svg'), 'w', encoding='utf-8') as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg">' + ''.join(symbols) + '</svg>\n')


if __name__ == '__main__':
    main()
