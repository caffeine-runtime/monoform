#!/usr/bin/env python3
"""Draws the app icon and the per-type document icons.

Writes the SVG sources to build/icon/, 1024/512 px PNGs to build/ (Wails
derives the macOS .icns from them) and multi-size .ico files to
build/windows/ (each size rendered on its own, so 16-32 px stay crisp).

Needs Pillow and a Chromium headless shell to render the SVGs:
    python3 scripts/icons.py [--chromium PATH]
(defaults to the Playwright headless shell under $PLAYWRIGHT_BROWSERS_PATH).
"""
import argparse
import glob
import io
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

ACCENT = ('#e3896a', '#c8643f')
NOTE = ('#efe3cc', '#d9c6a3')


# ---------------------------------------------------------------- app icon

def app_svg(small=False):
    """The stack of three notes on a dark tile. The tile fills the canvas and
    the notes fill the tile, so the icon reads at taskbar size; small=True
    (16-32 px) drops the shadow and the text lines and fattens the notes."""
    shadow = '' if small else ' filter="url(#s)"'
    lines = '' if small else '''
  <g transform="rotate(5 534 525)" stroke="#8a7a5e" stroke-width="26" stroke-linecap="round" opacity="0.8">
    <line x1="412" y1="400" x2="620" y2="400"/>
    <line x1="412" y1="470" x2="656" y2="470"/>
    <line x1="412" y1="540" x2="588" y2="540"/>
    <line x1="412" y1="610" x2="636" y2="610"/>
  </g>'''
    # Notes scaled about the tile's centre: 1.42 at full size, 1.55 when small.
    k = 1.55 if small else 1.42
    tile = (16, 16, 992, 216) if small else (24, 24, 976, 208)
    x, y, w, rx = tile
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3833"/>
      <stop offset="1" stop-color="#1f1e1d"/>
    </linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{ACCENT[0]}"/>
      <stop offset="1" stop-color="{ACCENT[1]}"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{NOTE[0]}"/>
      <stop offset="1" stop-color="{NOTE[1]}"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect x="{x}" y="{y}" width="{w}" height="{w}" rx="{rx}" fill="url(#bg)"/>
  <g transform="translate(512 518) scale({k}) translate(-517 -505)">
    <g{shadow}>
      <rect x="300" y="250" width="380" height="470" rx="44" fill="#77726a" transform="rotate(-12 490 485)"/>
      <rect x="322" y="262" width="380" height="470" rx="44" fill="url(#a)" transform="rotate(-4 512 497)"/>
      <rect x="344" y="290" width="380" height="470" rx="44" fill="url(#b)" transform="rotate(5 534 525)"/>
    </g>{lines}
  </g>
</svg>
'''


# ---------------------------------------------------------- document icons

PAGE = '''  <path d="M120 40 H322 L408 126 V442 a30 30 0 0 1 -30 30 H120 a30 30 0 0 1 -30 -30 V70 a30 30 0 0 1 30 -30 Z" fill="url(#p)" stroke="#b9a988" stroke-width="6"/>
  <path d="M322 40 V104 a22 22 0 0 0 22 22 H408 Z" fill="#d6c6a6" stroke="#b9a988" stroke-width="6" stroke-linejoin="round"/>'''

# The app's mark in the corner, so the files read as Hold It All's.
BADGE = f'''  <g transform="translate(300 352)">
    <rect width="118" height="118" rx="28" fill="#2a2926"/>
    <rect x="26" y="20" width="56" height="72" rx="10" fill="{ACCENT[1]}" transform="rotate(-7 54 56)"/>
    <rect x="38" y="26" width="56" height="72" rx="10" fill="{NOTE[0]}" transform="rotate(7 66 62)"/>
  </g>'''


def label(text, color):
    """A coloured band across the page with the type's name."""
    return f'''  <rect x="90" y="300" width="230" height="84" rx="14" fill="{color}"/>
  <text x="205" y="358" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="52" fill="#fff" letter-spacing="2">{text}</text>'''


def lines(color, ys=(170, 222, 274), lens=(154, 204, 124)):
    return '\n'.join(f'  <line x1="146" y1="{y}" x2="{146 + n}" y2="{y}" stroke="{color}" stroke-width="18" stroke-linecap="round"/>' for y, n in zip(ys, lens))


# Each type: (colour, glyph SVG). The glyph sits in the upper part of the
# page (about 130-330 x 110-330); the badge takes the lower right corner.
TYPES = {
    'text': ('#8f8170', lines('#a8977a', (150, 200, 250, 300), (200, 230, 160, 210))),
    'markdown': ('#4f7fb8', '''  <rect x="128" y="140" width="246" height="150" rx="22" fill="none" stroke="#4f7fb8" stroke-width="16"/>
  <path d="M160 260 V172 L200 220 L240 172 V260" fill="none" stroke="#4f7fb8" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M310 172 V250 M282 226 L310 256 L338 226" fill="none" stroke="#4f7fb8" stroke-width="18" stroke-linejoin="round" stroke-linecap="round"/>'''),
    'data': ('#8a5fb4', '''  <text x="250" y="292" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-weight="700" font-size="170" fill="#8a5fb4">{ }</text>'''),
    'table': ('#3f8a4f', '''  <rect x="130" y="130" width="240" height="190" rx="14" fill="#fff" stroke="#3f8a4f" stroke-width="12"/>
  <rect x="130" y="130" width="240" height="50" rx="12" fill="#3f8a4f"/>
  <path d="M130 225 H370 M130 272 H370 M210 130 V320 M290 130 V320" stroke="#3f8a4f" stroke-width="10"/>'''),
    'pdf': ('#c8463a', lines('#c9b597', (150, 200, 250), (200, 230, 160)) + '\n' + label('PDF', '#c8463a')),
    'image': ('#2f8a86', '''  <rect x="126" y="130" width="248" height="196" rx="18" fill="#dff0ee" stroke="#2f8a86" stroke-width="12"/>
  <circle cx="306" cy="182" r="24" fill="#e0a43c"/>
  <path d="M132 316 L210 220 L262 280 L298 244 L368 316 Z" fill="#2f8a86"/>'''),
    'vector': ('#d9772e', '''  <path d="M140 300 C 170 150, 330 150, 360 300" fill="none" stroke="#d9772e" stroke-width="14" stroke-linecap="round"/>
  <path d="M140 300 L196 160 M360 300 L304 160" stroke="#9a8b70" stroke-width="7"/>
  <rect x="124" y="284" width="32" height="32" fill="#fff" stroke="#d9772e" stroke-width="8"/>
  <rect x="344" y="284" width="32" height="32" fill="#fff" stroke="#d9772e" stroke-width="8"/>
  <circle cx="196" cy="160" r="15" fill="#d9772e"/>
  <circle cx="304" cy="160" r="15" fill="#d9772e"/>'''),
    'word': ('#3c6fc4', lines('#8aa6d8', (150, 200, 250), (200, 230, 160)) + '\n' + label('DOC', '#3c6fc4')),
    'archive': ('#a8772f', '''  <rect x="218" y="40" width="44" height="210" fill="#a8772f" opacity="0.18"/>
  <path d="M218 60 h22 v24 h-22 z M240 96 h22 v24 h-22 z M218 132 h22 v24 h-22 z M240 168 h22 v24 h-22 z M218 204 h22 v24 h-22 z" fill="#a8772f"/>
  <rect x="200" y="238" width="80" height="96" rx="14" fill="#a8772f"/>
  <rect x="222" y="262" width="36" height="30" rx="6" fill="#f6efe2"/>'''),
    'checksum': ('#4f8f4f', '''  <path d="M250 120 L350 158 V230 C350 290 304 326 250 344 C196 326 150 290 150 230 V158 Z" fill="#e3efdc" stroke="#4f8f4f" stroke-width="14" stroke-linejoin="round"/>
  <path d="M198 232 L236 270 L304 196" fill="none" stroke="#4f8f4f" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>'''),
    'web': ('#2f7fae', '''  <circle cx="250" cy="226" r="104" fill="none" stroke="#2f7fae" stroke-width="14"/>
  <ellipse cx="250" cy="226" rx="46" ry="104" fill="none" stroke="#2f7fae" stroke-width="12"/>
  <path d="M146 226 H354 M162 170 H338 M162 282 H338" stroke="#2f7fae" stroke-width="12"/>'''),
    'audio': ('#b44f8a', '''  <path d="M214 300 V150 L340 124 V272" fill="none" stroke="#b44f8a" stroke-width="18" stroke-linejoin="round"/>
  <ellipse cx="186" cy="300" rx="36" ry="28" fill="#b44f8a"/>
  <ellipse cx="312" cy="272" rx="36" ry="28" fill="#b44f8a"/>'''),
    'video': ('#6f55b8', '''  <rect x="126" y="140" width="248" height="176" rx="22" fill="#6f55b8"/>
  <path d="M222 182 L298 228 L222 274 Z" fill="#f6efe2"/>'''),
    'model': ('#2f8fb0', '''  <path d="M250 120 L350 172 V280 L250 332 L150 280 V172 Z" fill="#d7ecf3" stroke="#2f8fb0" stroke-width="14" stroke-linejoin="round"/>
  <path d="M150 172 L250 224 L350 172 M250 224 V332" fill="none" stroke="#2f8fb0" stroke-width="12" stroke-linejoin="round"/>
  <path d="M250 224 L350 172 V280 L250 332 Z" fill="#2f8fb0" opacity="0.35"/>'''),
}

# wails.json file associations: extension → type.
EXT_TYPE = {
    'txt': 'text', 'log': 'text',
    'md': 'markdown', 'markdown': 'markdown',
    'json': 'data', 'yaml': 'data', 'yml': 'data',
    'csv': 'table', 'tsv': 'table', 'xlsx': 'table', 'xls': 'table',
    'pdf': 'pdf',
    'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'gif': 'image', 'webp': 'image', 'bmp': 'image',
    'svg': 'vector',
    'docx': 'word', 'doc': 'word',
    'zip': 'archive', '7z': 'archive', 'rar': 'archive', 'tar': 'archive', 'gz': 'archive', 'tgz': 'archive',
    'sha256': 'checksum', 'md5': 'checksum',
    'html': 'web', 'htm': 'web',
    'mp3': 'audio', 'wav': 'audio', 'flac': 'audio', 'ogg': 'audio', 'm4a': 'audio', 'opus': 'audio',
    'mp4': 'video', 'mov': 'video', 'webm': 'video', 'mkv': 'video',
    'glb': 'model', 'gltf': 'model', 'stl': 'model', 'obj': 'model', 'fbx': 'model', '3mf': 'model', 'ply': 'model',
}


def doc_svg(kind, small=False):
    glyph = TYPES[kind][1]
    badge = '' if small else BADGE
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6efe2"/>
      <stop offset="1" stop-color="#e6d9c0"/>
    </linearGradient>
  </defs>
{PAGE}
{glyph}
{badge}
</svg>
'''


# ---------------------------------------------------------------- rendering

def find_chromium():
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
    found = sorted(glob.glob(os.path.join(base, 'chromium_headless_shell-*', '*', 'headless_shell')))
    return found[-1] if found else None


def render(chromium, svg, size, tmp):
    src = os.path.join(tmp, 'icon.svg')
    with open(src, 'w') as f:
        f.write(svg)
    page = os.path.join(tmp, 'page.html')
    with open(page, 'w') as f:
        f.write(f'<html><body style="margin:0;background:transparent"><img src="icon.svg" width="{size}" height="{size}"></body></html>')
    out = os.path.join(tmp, 'out.png')
    subprocess.run([chromium, '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--default-background-color=00000000', f'--window-size={size},{size}', f'--screenshot={out}', 'file://' + page],
                   check=True, capture_output=True)
    im = Image.open(out).convert('RGBA')
    im.load()
    return im


def write_ico(path, images):
    """An .ico with one image per size (PNG-compressed at 256)."""
    images = sorted(images, key=lambda im: im.width)
    largest = images[-1]
    largest.save(path, format='ICO', sizes=[(im.width, im.height) for im in images], append_images=images[:-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chromium', default=find_chromium())
    args = ap.parse_args()
    if not args.chromium:
        sys.exit('no Chromium headless shell found; pass --chromium')
    icon_dir = os.path.join(ROOT, 'build', 'icon')
    win_dir = os.path.join(ROOT, 'build', 'windows')
    with tempfile.TemporaryDirectory() as tmp:
        # App icon.
        with open(os.path.join(icon_dir, 'appicon.svg'), 'w') as f:
            f.write(app_svg())
        with open(os.path.join(icon_dir, 'appicon-small.svg'), 'w') as f:
            f.write(app_svg(small=True))
        render(args.chromium, app_svg(), 1024, tmp).save(os.path.join(ROOT, 'build', 'appicon.png'))
        ims = [render(args.chromium, app_svg(small=s <= 32), s, tmp) for s in ICO_SIZES]
        write_ico(os.path.join(win_dir, 'icon.ico'), ims)
        print('app icon')
        # Document icons, one per type.
        for kind in TYPES:
            name = f'file-{kind}'
            with open(os.path.join(icon_dir, name + '.svg'), 'w') as f:
                f.write(doc_svg(kind))
            render(args.chromium, doc_svg(kind), 512, tmp).save(os.path.join(ROOT, 'build', name + '.png'))
            ims = [render(args.chromium, doc_svg(kind, small=s <= 24), s, tmp) for s in ICO_SIZES]
            write_ico(os.path.join(win_dir, name + '.ico'), ims)
            print(name)
    # Point each file association at its type's icon.
    wj = os.path.join(ROOT, 'wails.json')
    with open(wj) as f:
        data = json.load(f)
    for a in data['info']['fileAssociations']:
        a['iconName'] = 'file-' + EXT_TYPE[a['ext']]
    with open(wj, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
