#!/usr/bin/env python3
"""Draws the README's animated banner: docs/readme/hero-dark.svg and
hero-light.svg (GitHub shows the one matching the reader's theme).

The app icon draws itself, the name and tagline rise in, and the file-type
icons (build/icon/file-*.svg) pop in and float. Text is converted to paths
from the app's own fonts (Source Serif 4, Inter; OFL), so it looks the same
everywhere. Plain CSS animations, off for readers who prefer reduced motion.

Needs fontTools and brotli (pip install fonttools brotli), and the frontend's
node_modules for the fonts:
    python3 scripts/readme_hero.py
"""
import os
import re
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
sys.dont_write_bytecode = True
from icons import M_PATH, TILE  # noqa: E402

FONTS = os.path.join(ROOT, 'frontend', 'node_modules', '@fontsource-variable')
SERIF = os.path.join(FONTS, 'source-serif-4', 'files', 'source-serif-4-latin-wght-normal.woff2')
SANS = os.path.join(FONTS, 'inter', 'files', 'inter-latin-wght-normal.woff2')

THEMES = {
    'dark': dict(bg='#191815', glow1='#c4613a', glow2='#2b7f7c', ink='#f1e9d6', muted='#a8a08f', pill='#262420', line='#3a3732', tile=TILE, mark='#ece2cb'),
    'light': dict(bg='#f7f3ea', glow1='#e8a07a', glow2='#8cc4bd', ink='#2a2925', muted='#6c655a', pill='#efe8da', line='#ddd3bf', tile=TILE, mark='#ece2cb'),
}

# Nine of the file types, in a 3×3 grid on the right.
GRID = ['markdown', 'pdf', 'image', 'table', 'vector', 'model', 'audio', 'video', 'archive']
PILLS = ['Free and open source', 'Works offline', 'No telemetry', 'Windows · macOS · Linux']


class Face:
    """Text set as SVG paths from a variable font at one weight."""

    def __init__(self, path, weight):
        font = TTFont(path)
        self.font = instantiateVariableFont(font, {'wght': weight}) if 'fvar' in font else font
        self.cmap = self.font.getBestCmap()
        self.glyphs = self.font.getGlyphSet()
        self.upm = self.font['head'].unitsPerEm
        self.hmtx = self.font['hmtx']

    def width(self, text, size):
        return sum(self.hmtx[self.cmap[ord(c)]][0] for c in text) * size / self.upm

    def path(self, text, x, y, size, fill, cls='', tracking=0.0):
        s = size / self.upm
        out = []
        for ch in text:
            name = self.cmap[ord(ch)]
            pen = SVGPathPen(self.glyphs)
            self.glyphs[name].draw(pen)
            d = pen.getCommands()
            if d:
                out.append(f'<path transform="translate({x:.2f} {y:.2f}) scale({s:.5f} {-s:.5f})" d="{d}"/>')
            x += self.hmtx[name][0] * s + tracking
        c = f' class="{cls}"' if cls else ''
        return f'<g{c} fill="{fill}">{"".join(out)}</g>'


def file_icon(kind):
    """The inner shapes of a document icon (512 grid)."""
    src = open(os.path.join(ROOT, 'build', 'icon', f'file-{kind}.svg')).read()
    return re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', src, flags=re.S)


CSS = '''
  .draw { stroke-dasharray: 2600; stroke-dashoffset: 0; animation: draw 2.2s cubic-bezier(.6,.1,.3,1) backwards; }
  .fillin { animation: fillin 1s 1.3s ease-out backwards; }
  .tile { transform-box: fill-box; transform-origin: center; animation: pop .7s cubic-bezier(.3,1.4,.5,1) backwards; }
  .rise { animation: rise .9s cubic-bezier(.2,.8,.2,1) backwards; }
  .pop { transform-box: fill-box; transform-origin: center; animation: pop .6s cubic-bezier(.3,1.5,.5,1) backwards; }
  .bob { animation: bob 5s ease-in-out infinite alternate; }
  .glow { animation: drift 14s ease-in-out infinite alternate; }
  @keyframes draw { from { stroke-dashoffset: 2600; } }
  @keyframes fillin { from { fill-opacity: 0; } }
  @keyframes pop { from { transform: scale(.4); opacity: 0; } }
  @keyframes rise { from { transform: translateY(18px); opacity: 0; } }
  @keyframes bob { from { transform: translateY(-5px); } to { transform: translateY(5px); } }
  @keyframes drift { from { transform: translate(-30px, 10px); } to { transform: translate(40px, -16px); } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
'''


def hero(theme, serif, sans, sans_med):
    t = THEMES[theme]
    W, H = 1200, 420
    parts = []
    # Background with two soft glows.
    parts.append(f'''<defs>
    <radialGradient id="g1"><stop offset="0" stop-color="{t['glow1']}" stop-opacity=".35"/><stop offset="1" stop-color="{t['glow1']}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2"><stop offset="0" stop-color="{t['glow2']}" stop-opacity=".28"/><stop offset="1" stop-color="{t['glow2']}" stop-opacity="0"/></radialGradient>
    <clipPath id="frame"><rect width="{W}" height="{H}" rx="28"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
  <rect width="{W}" height="{H}" fill="{t['bg']}"/>
  <g class="glow"><circle cx="980" cy="120" r="330" fill="url(#g1)"/></g>
  <g class="glow" style="animation-delay:-7s"><circle cx="160" cy="380" r="300" fill="url(#g2)"/></g>''')
    # The app icon: the tile pops, the M draws itself and fills.
    k = 128 / 1024
    parts.append(f'''<g transform="translate(76 70) scale({k})">
    <rect class="tile" x="24" y="24" width="976" height="976" rx="208" fill="{t['tile']}"/>
    <path transform="translate(512 512) scale(1.3) translate(-512 -511)" class="draw fillin" d="{M_PATH}" fill="{t['mark']}" stroke="{t['mark']}" stroke-width="10" stroke-linejoin="round"/>
  </g>''')
    # Name, tagline, pills.
    parts.append(f'<g class="rise" style="animation-delay:.35s">{serif.path("Monoform", 232, 160, 96, t["ink"], tracking=-1.5)}</g>')
    parts.append(f'<g class="rise" style="animation-delay:.6s">{sans.path("One calm, fast window for every everyday file.", 80, 262, 29, t["ink"])}</g>')
    parts.append(f'<g class="rise" style="animation-delay:.75s">{sans.path("Notes, PDFs, images, spreadsheets, 3D, audio, video and more.", 80, 302, 21, t["muted"])}</g>')
    x = 80
    for i, label in enumerate(PILLS):
        w = sans_med.width(label, 15) + 28
        parts.append(f'''<g class="rise" style="animation-delay:{0.95 + i * 0.12:.2f}s">
    <rect x="{x}" y="334" width="{w:.1f}" height="34" rx="17" fill="{t['pill']}" stroke="{t['line']}"/>
    {sans_med.path(label, x + 14, 356, 15, t['ink'])}
  </g>''')
        x += w + 10
    # The file types: pop in one after another, then float.
    size, gap, gx, gy = 104, 14, 812, 54
    for i, kind in enumerate(GRID):
        cx, cy = gx + (i % 3) * (size + gap), gy + (i // 3) * (size + gap)
        parts.append(f'''<g class="bob" style="animation-delay:{-i * 0.55:.2f}s"><g class="pop" style="animation-delay:{0.5 + i * 0.09:.2f}s">
    <svg x="{cx}" y="{cy}" width="{size}" height="{size}" viewBox="40 20 432 472">{file_icon(kind)}</svg>
  </g></g>''')
    parts.append('</g>')
    body = '\n  '.join(parts)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Monoform — one calm, fast window for every everyday file">
  <style>{CSS}</style>
  {body}
</svg>
'''


def main():
    serif = Face(SERIF, 600)
    sans = Face(SANS, 400)
    sans_med = Face(SANS, 500)
    out = os.path.join(ROOT, 'docs', 'readme')
    os.makedirs(out, exist_ok=True)
    for theme in THEMES:
        path = os.path.join(out, f'hero-{theme}.svg')
        with open(path, 'w') as f:
            f.write(hero(theme, serif, sans, sans_med))
        print(path, os.path.getsize(path))


if __name__ == '__main__':
    main()
