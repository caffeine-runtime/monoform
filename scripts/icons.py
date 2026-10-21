#!/usr/bin/env python3
"""Draws the Monoform logo, the app icon and the per-type document icons.

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
import re
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

# The Monoform mark: one rounded "M" (cream on near-black). Drawn as Bezier
# paths on a 1024 grid, centred on (512, 512).
INK = '#ece2cb'
TILE = '#2a2925'
M_PATH = (
    'M 236 708 C 222 711 214 698 218 686 L 302 368 C 314 322 352 312 380 314 '
    'C 404 316 424 330 438 352 L 490 448 C 497 461 495 472 487 482 L 458 540 '
    'C 486 536 506 520 520 500 L 584 360 C 598 330 626 314 654 314 '
    'C 690 316 712 340 718 368 L 806 686 C 810 700 800 712 786 708 L 700 690 '
    'C 674 684 660 668 652 640 L 636 592 C 630 574 610 574 604 592 L 580 646 '
    'C 556 692 470 692 446 646 L 420 592 C 414 574 394 574 388 592 L 372 640 '
    'C 364 668 350 684 324 690 Z'
)


def mark(k, fill=INK):
    """The M scaled by k about the centre of the 1024 grid."""
    return f'<path transform="translate(512 512) scale({k}) translate(-512 -511)" fill="{fill}" d="{M_PATH}"/>'


def logo_svg():
    """The logo as designed: the mark on a dark square."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="{TILE}"/>
  {mark(1)}
</svg>
'''


def mark_svg():
    """The mark alone (transparent background, takes the text colour)."""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="200 300 624 424">
  <path fill="currentColor" d="{M_PATH}"/>
</svg>
'''


# ---------------------------------------------------------------- app icon

def app_svg(small=False):
    """The mark on a dark rounded tile. The tile fills the canvas and the mark
    most of the tile, so the icon reads at taskbar size; at 16-32 px the mark
    is a little bigger still."""
    k = 1.42 if small else 1.3
    x, w, rx = (16, 992, 216) if small else (24, 976, 208)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="{x}" y="{x}" width="{w}" height="{w}" rx="{rx}" fill="{TILE}"/>
  {mark(k)}
</svg>
'''


# ---------------------------------------------------------- document icons
#
# One form for every type, made from the app icon's parts: the same cream
# page (the logo's ink colour), the same rounded tile in the same place with
# the type's symbol in cream, and the M in the corner. Only the tile's colour
# (all at about the same depth) and the symbol change. Symbols are Lucide
# icons (ISC, the set the app's interface uses): one stroke weight, one size.

LUCIDE = os.path.join(ROOT, 'frontend', 'node_modules', '@lucide', 'svelte', 'dist', 'icons')

# kind → (tile colour, Lucide icon)
TYPES = {
    'text': ('#6f675d', 'text-align-start'),
    'markdown': ('#3d6aa3', 'hash'),
    'data': ('#7a52a3', 'braces'),
    'table': ('#3c7f52', 'sheet'),
    'pdf': ('#b0453a', 'scroll-text'),
    'image': ('#2d7f7c', 'image'),
    'vector': ('#b5662d', 'pen-tool'),
    'word': ('#3b5fa8', 'type'),
    'archive': ('#8f6a35', 'archive'),
    'checksum': ('#4c7f3c', 'shield-check'),
    'web': ('#2e70a0', 'globe'),
    'audio': ('#a0467b', 'music'),
    'video': ('#6450a8', 'clapperboard'),
    'model': ('#2b7f9c', 'box'),
}


def lucide(name):
    """A Lucide icon's shapes (24-unit grid) as SVG elements."""
    path = os.path.join(LUCIDE, name + '.svelte')
    if not os.path.exists(path):  # an alias: name.js re-exports another icon
        js = open(os.path.join(LUCIDE, name + '.js')).read()
        path = os.path.join(LUCIDE, re.search(r'from "\./([^"]+)"', js).group(1))
    src = open(path).read()
    data = json.loads(re.search(r'const iconData = (\{.*?\});', src, re.S).group(1))
    return ''.join('<%s %s/>' % (tag, ' '.join(f'{k}="{v}"' for k, v in attrs.items() if k != 'key')) for tag, attrs in data['node'])


PAGE = (
    '<path d="M120 40 H322 L408 126 V442 a30 30 0 0 1 -30 30 H120 a30 30 0 0 1 -30 -30 V70 a30 30 0 0 1 30 -30 Z" '
    f'fill="{INK}" stroke="#b9ad93" stroke-width="6" stroke-linejoin="round"/>'
    '<path d="M322 40 V104 a22 22 0 0 0 22 22 H408 Z" fill="#d6c9ac" stroke="#b9ad93" stroke-width="6" stroke-linejoin="round"/>'
)

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
    """A type's document icon. small (16-24 px): no M, a bigger tile."""
    color, icon = TYPES[kind]
    # The tile: the same square for every type, centred low on the page.
    t, y = (236, 196) if small else (196, 222)
    x = 249 - t / 2
    k = t * 0.62 / 24  # the 24-unit symbol fills 62% of the tile
    gx, gy = 249 - 12 * k, y + t / 2 - 12 * k
    sw = 2.25 if small else 2  # Lucide's stroke, a little heavier when tiny
    corner = '' if small else f'<g transform="translate(112 64) scale({84 / 1024})">{mark(1.3, TILE)}</g>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  {PAGE}
  {corner}
  <rect x="{x:.1f}" y="{y}" width="{t}" height="{t}" rx="{t * 0.21:.1f}" fill="{color}"/>
  <g transform="translate({gx:.2f} {gy:.2f}) scale({k:.4f})" fill="none" stroke="{INK}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{lucide(icon)}</g>
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
        # The logo, and the app icon made from it.
        with open(os.path.join(icon_dir, 'logo.svg'), 'w') as f:
            f.write(logo_svg())
        with open(os.path.join(icon_dir, 'logo-mark.svg'), 'w') as f:
            f.write(mark_svg())
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
