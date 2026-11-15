#!/usr/bin/env python3
"""tiaTube logo generator.

Writes one SVG per site, in two forms:
  <name>.svg       the letters as outlines: no font is needed to show it
  <name>-text.svg  the source form with <text> elements: needs JetBrains Mono ExtraBold and Oswald SemiBold

Every element is placed by its drawn outline (ink), not by font metrics: the "tia" and the word are centred
horizontally, the word is centred in the white box, and the whole white block is centred vertically.

usage: logo.py --fonts DIR [--out DIR] [--only tube,face,web]
needs: fonttools, uharfbuzz
"""
import argparse
import os

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# geometry, in units of the 100x100 view box
SHAPE_RADIUS = 24          # rounded top-left and bottom-right corners
TIA = dict(font='JetBrainsMono-ExtraBold.ttf', family='JetBrains Mono', weight=800, size=26.1, spacing=-0.7)
BOX = dict(width=55.4, height=33.5, radius=6)
GAP = 4.8                  # between the bottom of "tia" and the top of the box
WORD = dict(font='Oswald-SemiBold.ttf', family='Oswald', weight=600, size=26.5)

SITES = {
    'tube': dict(word='Tube', color='#b3212b', width=46.0),
    'face': dict(word='Face', color='#2d5aa8', width=46.0),
    'web': dict(word='Web', color='#1b7f86', width=None),   # natural width: a short word is not stretched
}


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
    Returns (path data, ink bounds (x0, y0, x1, y1), horizontal scale) in view box units."""
    s = size / font.upem
    glyphs = font.shape(text)
    advance = sum(a for _, a, _ in glyphs) * s + spacing * (len(glyphs) - 1)
    sx = width / advance if width else 1.0      # like SVG textLength with lengthAdjust="spacingAndGlyphs"
    # the glyph set resolves composite glyphs (e.g. the dot of the i)
    pen, bounds = SVGPathPen(font.glyphs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.')), BoundsPen(font.glyphs)
    x = 0.0
    for name, adv, off in glyphs:
        t = (s * sx, 0, 0, -s, x + off * s * sx, 0)
        font.glyphs[name].draw(TransformPen(pen, t))
        font.glyphs[name].draw(TransformPen(bounds, t))
        x += (adv * s + spacing) * sx
    return pen.getCommands(), bounds.bounds, sx


def shape_path():
    r = SHAPE_RADIUS
    return f'M{r} 0H100V{100 - r}A{r} {r} 0 0 1 {100 - r} 100H0V{r}A{r} {r} 0 0 1 {r} 0Z'


def layout(fonts, site):
    tia_d, tia_b, _ = run(fonts['tia'], 'tia', TIA['size'], TIA['spacing'])
    word_d, word_b, word_sx = run(fonts['word'], site['word'], WORD['size'], width=site['width'])
    tia_h = tia_b[3] - tia_b[1]
    top = 50 - (tia_h + GAP + BOX['height']) / 2
    box_x, box_y = 50 - BOX['width'] / 2, top + tia_h + GAP
    # translations that move each ink box to its place
    tia_t = (50 - (tia_b[0] + tia_b[2]) / 2, top - tia_b[1])
    word_t = (50 - (word_b[0] + word_b[2]) / 2, box_y + BOX['height'] / 2 - (word_b[1] + word_b[3]) / 2)
    return dict(tia_d=tia_d, tia_t=tia_t, word_d=word_d, word_t=word_t, word_sx=word_sx, box=(box_x, box_y))


def fmt(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def svg_paths(lay, site):
    bx, by = lay['box']
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
            f'  <path d="{shape_path()}" fill="{site["color"]}"/>\n'
            f'  <path transform="translate({fmt(lay["tia_t"][0])} {fmt(lay["tia_t"][1])})" d="{lay["tia_d"]}" fill="#fff"/>\n'
            f'  <rect x="{fmt(bx)}" y="{fmt(by)}" width="{BOX["width"]}" height="{BOX["height"]}" rx="{BOX["radius"]}" fill="#fff"/>\n'
            f'  <path transform="translate({fmt(lay["word_t"][0])} {fmt(lay["word_t"][1])})" d="{lay["word_d"]}" fill="{site["color"]}"/>\n'
            f'</svg>\n')


def svg_text(lay, site):
    """The same layout with <text>: the baseline origin of each line is the translation of its outline."""
    bx, by = lay['box']
    width = f' textLength="{site["width"]}" lengthAdjust="spacingAndGlyphs"' if site['width'] else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
            f'  <path d="{shape_path()}" fill="{site["color"]}"/>\n'
            f'  <text x="{fmt(lay["tia_t"][0])}" y="{fmt(lay["tia_t"][1])}" font-family="{TIA["family"]}" font-weight="{TIA["weight"]}"'
            f' font-size="{TIA["size"]}" letter-spacing="{TIA["spacing"]}" fill="#fff">tia</text>\n'
            f'  <rect x="{fmt(bx)}" y="{fmt(by)}" width="{BOX["width"]}" height="{BOX["height"]}" rx="{BOX["radius"]}" fill="#fff"/>\n'
            f'  <text x="{fmt(lay["word_t"][0])}" y="{fmt(lay["word_t"][1])}" font-family="{WORD["family"]}" font-weight="{WORD["weight"]}"'
            f' font-size="{WORD["size"]}"{width} fill="{site["color"]}">{site["word"]}</text>\n'
            f'</svg>\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fonts', required=True, help='directory with the two TTF files')
    ap.add_argument('--out', default='.', help='output directory')
    ap.add_argument('--only', default=','.join(SITES), help='comma separated sites')
    a = ap.parse_args()
    fonts = {'tia': Font(os.path.join(a.fonts, TIA['font'])), 'word': Font(os.path.join(a.fonts, WORD['font']))}
    os.makedirs(a.out, exist_ok=True)
    for key in a.only.split(','):
        site = SITES[key]
        lay = layout(fonts, site)
        for suffix, body in (('', svg_paths(lay, site)), ('-text', svg_text(lay, site))):
            path = os.path.join(a.out, f'tia{key}{suffix}.svg')
            with open(path, 'w') as f:
                f.write(body)
            print(path)


if __name__ == '__main__':
    main()
