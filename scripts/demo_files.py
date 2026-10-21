#!/usr/bin/env python3
"""Writes the demo folder the README clips and screenshots are made from:
a small trip plan ("Lisbon trip") with a note, a picture, a PDF guide, a
budget, a tile pattern, a song sketch, a clip and a 3D souvenir.

    python3 scripts/demo_files.py OUT_DIR [--chromium PATH]

Everything is generated here (no downloads); the portrait is the NASA photo
the self-tests use (public domain). Needs Pillow, numpy, openpyxl, ffmpeg and
a Chromium headless shell (for the PDF).
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import wave
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------ the picture

def tram_picture(path, w=1600, h=1000):
    """A flat illustration of Lisbon: sunset sky, the river, houses on the
    hill and a yellow tram in front (flat colours, so the magic wand takes
    the tram in one click)."""
    s = 2  # drawn at 2x, then scaled down for smooth edges
    W, H = w * s, h * s
    sky = np.zeros((H, W, 3), np.float32)
    top, bottom = np.array([84, 110, 168]), np.array([246, 190, 140])
    t = np.linspace(0, 1, H)[:, None, None] ** 1.3
    sky[:] = top * (1 - t) + bottom * t
    im = Image.fromarray(sky.astype(np.uint8))
    d = ImageDraw.Draw(im)
    # Sun and its glow.
    for r, a in ((260, 40), (190, 70), (130, 255)):
        glow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(glow).ellipse((1150 * s - r * s, 330 * s - r * s, 1150 * s + r * s, 330 * s + r * s), fill=a)
        glow = glow.filter(ImageFilter.GaussianBlur(30 * s if a < 255 else 0))
        im.paste((255, 222, 160) if a < 255 else (255, 236, 196), (0, 0), glow)
    # The river and the far bank.
    d.rectangle((0, 520 * s, W, 640 * s), fill=(108, 140, 178))
    for i in range(14):
        y = (535 + i * 8) * s
        d.line((((i * 97) % 1500) * s, y, (((i * 97) % 1500) + 60 + i * 4) * s, y), fill=(196, 196, 206), width=2 * s)
    d.polygon([(0, 520 * s), (300 * s, 480 * s), (700 * s, 505 * s), (1100 * s, 470 * s), (W, 500 * s), (W, 520 * s)], fill=(122, 112, 140))
    # The hill with its houses: rows of pastel facades under terracotta roofs.
    d.polygon([(0, 640 * s), (0, 470 * s), (500 * s, 540 * s), (900 * s, 600 * s), (W, 640 * s)], fill=(196, 150, 120))
    facades = [(238, 214, 170), (226, 160, 140), (176, 196, 214), (240, 230, 214), (214, 180, 120), (190, 210, 186), (232, 196, 196)]
    rng = np.random.default_rng(7)
    for row, (y0, x0, x1) in enumerate(((560, 0, 820), (610, 0, 1600), (660, 0, 1600))):
        x = x0
        while x < x1:
            bw = int(rng.integers(70, 120))
            bh = int(rng.integers(70, 120)) + row * 10
            c = facades[int(rng.integers(len(facades)))]
            y = y0 - bh + row * 40
            d.rectangle((x * s, y * s, (x + bw) * s, (y0 + 80) * s), fill=c)
            d.polygon([((x - 4) * s, y * s), ((x + bw // 2) * s, (y - 26) * s), ((x + bw + 4) * s, y * s)], fill=(178, 92, 64))
            for wx in range(x + 14, x + bw - 18, 28):
                for wy in range(y + 18, y0 + 60, 34):
                    d.rectangle((wx * s, wy * s, (wx + 12) * s, (wy + 18) * s), fill=(84, 92, 110))
            x += bw + int(rng.integers(0, 6))
    # The street and the rails.
    d.rectangle((0, 760 * s, W, H), fill=(146, 132, 122))
    for x in range(0, w, 60):
        d.line((x * s, 790 * s, (x + 40) * s, 790 * s), fill=(160, 146, 136), width=3 * s)
    for y in (900, 930):
        d.line((0, y * s, W, y * s), fill=(98, 92, 90), width=6 * s)
    # The tram: one flat yellow body, white band, dark windows.
    x0, y0, x1, y1 = 420, 560, 1180, 900
    yellow = (244, 190, 34)
    d.rounded_rectangle((x0 * s, y0 * s, x1 * s, y1 * s), radius=38 * s, fill=yellow)
    d.rectangle(((x0 + 6) * s, (y0 + 168) * s, (x1 - 6) * s, (y0 + 196) * s), fill=(250, 244, 226))
    for wx in range(x0 + 46, x1 - 80, 112):
        d.rounded_rectangle((wx * s, (y0 + 40) * s, (wx + 84) * s, (y0 + 138) * s), radius=8 * s, fill=(62, 70, 88))
    d.rounded_rectangle(((x1 - 70) * s, (y0 + 40) * s, (x1 - 24) * s, (y0 + 250) * s), radius=8 * s, fill=(62, 70, 88))
    d.line(((x0 + 200) * s, y0 * s, (x0 + 320) * s, (y0 - 120) * s), fill=(60, 60, 66), width=5 * s)
    d.line(((x0 + 320) * s, (y0 - 120) * s, (x0 + 380) * s, (y0 - 120) * s), fill=(60, 60, 66), width=5 * s)
    d.text(((x0 + 60) * s, (y0 + 232) * s), '28', fill=(250, 244, 226), font_size=46 * s)
    for wx in (x0 + 110, x1 - 150):
        d.ellipse(((wx - 34) * s, (y1 - 22) * s, (wx + 34) * s, (y1 + 46) * s), fill=(46, 44, 48))
    im = im.resize((w, h), Image.LANCZOS)
    im.save(path, optimize=True)


# ---------------------------------------------------------------- the note

PLAN = """# Lisbon — four days in May

![Tram 28 at sunset](tram-28.png)

A long weekend of trams, tiles and pastéis de nata. Flights are booked,
the flat in **Alfama** is paid, the rest is below.

## Route

```mermaid
flowchart LR
  A[Alfama] --> B[Belém]
  B --> C[Sintra]
  C --> D[LX Factory]
```

## To do

- ~~Flights~~ (TAP, Thursday 08:40)
- ~~Flat in Alfama~~, 3 nights
- Oceanarium tickets
- Ask Ana about the fado bar

## Days

| Day | Where | Budget |
|-----|-------|-------:|
| Thu | Alfama, Tram 28, Miradouro | €45 |
| Fri | Belém: tower, monastery, pastéis | €60 |
| Sat | Sintra: Pena palace | €70 |
| Sun | LX Factory, flight home | €40 |

> Tip: buy a Viva Viagem card at the airport — €7.10 for 24 h of trams.
"""

NOTE = """# Packing

- passport, charger, adapter
- comfortable shoes (hills!)
- light jacket for the evenings
"""


# ----------------------------------------------------------------- the PDF

GUIDE = """<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 0; }}
body {{ margin: 0; font-family: 'Source Serif 4', Georgia, serif; color: #2a2925; }}
.page {{ width: 210mm; height: 297mm; box-sizing: border-box; padding: 18mm 20mm; page-break-after: always; position: relative; }}
.cover {{ padding: 0; background: #2a2925; color: #f4ecd8; }}
.cover img {{ width: 100%; height: 170mm; object-fit: cover; display: block; }}
.cover .t {{ padding: 16mm 20mm; }}
h1 {{ font-size: 44pt; margin: 0 0 4mm; font-weight: 600; letter-spacing: -0.5pt; }}
h2 {{ font-size: 20pt; margin: 0 0 4mm; color: #b0453a; }}
p, li {{ font-size: 11.5pt; line-height: 1.55; }}
.kicker {{ font: 600 10pt Inter, sans-serif; letter-spacing: 2pt; text-transform: uppercase; color: #e0b44a; }}
.cols {{ columns: 2; column-gap: 10mm; }}
.box {{ background: #f4ecd8; border-radius: 4mm; padding: 6mm 8mm; margin: 6mm 0; }}
table {{ border-collapse: collapse; width: 100%; font: 10.5pt Inter, sans-serif; }}
td, th {{ border-bottom: 1px solid #ddd2bb; padding: 2.5mm 2mm; text-align: left; }}
.foot {{ position: absolute; bottom: 12mm; left: 20mm; right: 20mm; font: 9pt Inter, sans-serif; color: #8a8478; display: flex; justify-content: space-between; }}
</style></head><body>
<div class="page cover"><img src="{img}"><div class="t"><div class="kicker">City guide · Spring</div>
<h1>Lisbon in four days</h1><p>Seven hills, one yellow tram and the best custard tart in Europe — a short plan for a long weekend.</p></div></div>
<div class="page"><div class="kicker">Day 1</div><h2>Alfama and Tram 28</h2><div class="cols">
<p>Start early at Martim Moniz and take Tram 28 before the queues form. Sit on the right for the view over the river as the tram climbs to Graça.</p>
<p>Get off at Miradouro de Santa Luzia: tiled benches, bougainvillea and the roofs of Alfama falling down to the Tagus. Walk down through the alleys — getting lost is the plan.</p>
<p>Lunch: grilled sardines at any place with a handwritten menu. In the evening, a fado house; book ahead on weekends.</p>
<p>The cathedral (Sé) and the castle are both on the way; the castle is worth it for the sunset alone.</p></div>
<div class="box"><b>Getting around.</b> A Viva Viagem card covers trams, buses, the metro and the ferry across the river. Load it with “zapping” credit rather than single tickets.</div>
<div class="kicker">Day 2</div><h2>Belém</h2><div class="cols">
<p>Jerónimos Monastery opens at 9:30; the cloister is the highlight. Next door, Pastéis de Belém has sold the original custard tart since 1837 — eat them warm with cinnamon.</p>
<p>Walk along the river to the Padrão dos Descobrimentos and Belém Tower. The MAAT museum’s roof is a free viewpoint.</p></div>
<div class="foot"><span>Lisbon in four days</span><span>2</span></div></div>
<div class="page"><div class="kicker">Budget</div><h2>What it costs</h2>
<table><tr><th>Item</th><th>Category</th><th>€</th></tr>
<tr><td>Flights (return)</td><td>Travel</td><td>184</td></tr><tr><td>Flat in Alfama, 3 nights</td><td>Stay</td><td>312</td></tr>
<tr><td>Viva Viagem, 4 days</td><td>Travel</td><td>28</td></tr><tr><td>Pena Palace + park</td><td>Sights</td><td>20</td></tr>
<tr><td>Jerónimos Monastery</td><td>Sights</td><td>12</td></tr><tr><td>Food and coffee</td><td>Food</td><td>215</td></tr>
<tr><th>Total</th><th></th><th>771</th></tr></table>
<div class="box"><b>Good to know.</b> Many museums are free on Sunday mornings for residents only; for visitors the Lisboa Card pays off from about three sights a day.</div>
<div class="foot"><span>Lisbon in four days</span><span>3</span></div></div>
</body></html>"""


def guide_pdf(path, picture, chromium):
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(picture, os.path.join(tmp, 'pic.png'))
        html = os.path.join(tmp, 'guide.html')
        with open(html, 'w') as f:
            f.write(GUIDE.format(img='pic.png'))
        subprocess.run([chromium, '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={path}', 'file://' + html],
                       check=True, capture_output=True)


# -------------------------------------------------------------- the budget

def budget_xlsx(path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = 'Budget'
    rows = [('Item', 'Category', 'Planned', 'Spent', 'Left'),
            ('Flights', 'Travel', 190, 184), ('Flat in Alfama', 'Stay', 320, 312), ('Viva Viagem card', 'Travel', 30, 28),
            ('Pena Palace', 'Sights', 20, 20), ('Jerónimos Monastery', 'Sights', 12, 12), ('Oceanarium', 'Sights', 25, 0),
            ('Food and coffee', 'Food', 240, 215), ('Fado night', 'Fun', 60, 0), ('Souvenirs', 'Fun', 50, 18)]
    for i, r in enumerate(rows, 1):
        ws.append(list(r) + ([f'=C{i}-D{i}'] if i > 1 else []))
    n = len(rows)
    ws.append(['Total', '', f'=SUM(C2:C{n})', f'=SUM(D2:D{n})', f'=SUM(E2:E{n})'])
    for c in ws[1] + ws[n + 1]:
        c.font = Font(bold=True)
    for c in ws[1]:
        c.fill = PatternFill('solid', fgColor='F4ECD8')
    for col, wdt in zip('ABCDE', (24, 12, 10, 10, 10)):
        ws.column_dimensions[col].width = wdt
    wb.save(path)


# --------------------------------------------------------- the tile pattern

def azulejo_svg(path):
    """A blue-and-white tile in the Portuguese style, 2×2."""
    blue, white = '#1f4e96', '#f6f2e8'
    tile = f'''<g>
    <rect width="200" height="200" fill="{white}"/>
    <circle cx="100" cy="100" r="70" fill="none" stroke="{blue}" stroke-width="10"/>
    <path d="M100 30 C120 70 130 80 170 100 C130 120 120 130 100 170 C80 130 70 120 30 100 C70 80 80 70 100 30 Z" fill="{blue}"/>
    <circle cx="100" cy="100" r="16" fill="{white}"/>
    <path d="M0 0 H50 A50 50 0 0 1 0 50 Z M200 0 V50 A50 50 0 0 1 150 0 Z M0 200 V150 A50 50 0 0 1 50 200 Z M200 200 H150 A50 50 0 0 1 200 150 Z" fill="{blue}"/>
  </g>'''
    with open(path, 'w') as f:
        f.write(f'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs><g id="tile">{tile}</g></defs>
  <use href="#tile"/><use href="#tile" x="200"/><use href="#tile" y="200"/><use href="#tile" x="200" y="200"/>
  <rect x="5" y="5" width="390" height="390" fill="none" stroke="#c9bfa6" stroke-width="10"/>
</svg>
''')


# ---------------------------------------------------------------- the song

def song_wav(path, sr=44100):
    """A few bars of plucked guitar (Karplus-Strong), A minor."""
    notes = [57, 64, 69, 72, 76, 72, 69, 64, 53, 60, 65, 69, 72, 69, 65, 60, 52, 59, 64, 68, 71, 68, 64, 59, 57, 64, 69, 72, 76, 81]
    step = 0.26
    out = np.zeros(int(sr * (len(notes) * step + 2.5)))
    rng = np.random.default_rng(3)
    for i, m in enumerate(notes):
        f = 440 * 2 ** ((m - 69) / 12)
        n = int(sr / f)
        buf = rng.uniform(-1, 1, n)
        dur = int(sr * 2.2)
        y = np.empty(dur)
        for k in range(dur):  # the classic loop, kept simple (a few seconds)
            y[k] = buf[k % n]
            buf[k % n] = 0.996 * 0.5 * (buf[k % n] + buf[(k + 1) % n])
        start = int(i * step * sr)
        out[start:start + dur] += y * (0.55 if i % 8 == 0 else 0.35)
    out /= np.abs(out).max() * 1.1
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((out * 32767).astype('<i2').tobytes())


# ---------------------------------------------------------------- the clip

def clip_webm(path, picture):
    """Six seconds slowly panning over the picture."""
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', picture, '-vf',
                    "scale=3200:-1,zoompan=z='1.25-0.0015*on':x='iw/2-(iw/zoom/2)+on*1.2':y='ih/2-(ih/zoom/2)':d=150:s=1280x800:fps=25",
                    '-t', '6', '-c:v', 'libvpx-vp9', '-b:v', '1.5M', '-pix_fmt', 'yuv420p', path], check=True)


# ------------------------------------------------- a document, data, a page

def itinerary_docx(path):
    from docx import Document
    from docx.shared import Pt, RGBColor

    doc = Document()
    doc.add_heading('Lisbon — itinerary', 0)
    p = doc.add_paragraph('Four days, three nights, one tram. ')
    p.add_run('Everything below is booked unless marked otherwise.').italic = True
    for day, text in (('Thursday', 'Land 11:05, drop bags in Alfama, Tram 28 to Graça, sunset at the castle.'),
                      ('Friday', 'Belém: Jerónimos at 9:30, pastéis, the tower, MAAT roof. Dinner in Cais do Sodré.'),
                      ('Saturday', 'Train from Rossio to Sintra (40 min). Pena Palace, then Quinta da Regaleira.'),
                      ('Sunday', 'LX Factory market, lunch by the river, flight at 19:20.')):
        doc.add_heading(day, level=2)
        doc.add_paragraph(text)
    t = doc.add_table(rows=1, cols=3)
    t.style = 'Light Grid Accent 1'
    for c, h in zip(t.rows[0].cells, ('What', 'When', 'Reference')):
        c.text = h
    for r in (('Flight out', 'Thu 08:40', 'TP 1331'), ('Flat', 'Thu–Sun', 'AL-2291'), ('Flight back', 'Sun 19:20', 'TP 1336')):
        for c, v in zip(t.add_row().cells, r):
            c.text = v
    note = doc.add_paragraph().add_run('Keep a copy of this on your phone — the flat has no printer.')
    note.font.size = Pt(9)
    note.font.color.rgb = RGBColor(0x8a, 0x84, 0x78)
    doc.save(path)


ITINERARY = {
    'trip': 'Lisbon', 'from': '2027-05-13', 'to': '2027-05-16', 'travellers': ['Ana', 'Tomek'],
    'flights': [{'number': 'TP 1331', 'departs': '2027-05-13T08:40', 'seat': '14C'}, {'number': 'TP 1336', 'departs': '2027-05-16T19:20', 'seat': '9A'}],
    'stay': {'name': 'Flat in Alfama', 'nights': 3, 'paid': True, 'checkIn': '15:00'},
    'days': [{'day': 'Thu', 'places': ['Alfama', 'Tram 28', 'Castelo']}, {'day': 'Fri', 'places': ['Belém', 'MAAT']},
             {'day': 'Sat', 'places': ['Sintra', 'Pena Palace']}, {'day': 'Sun', 'places': ['LX Factory']}],
}

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lisbon trip</title><style>
body { margin: 0; font-family: Georgia, serif; background: #f4ecd8; color: #2a2925; }
header { padding: 48px 40px; background: #2a2925; color: #f4ecd8; }
h1 { margin: 0; font-size: 40px; } header p { color: #e0b44a; letter-spacing: 2px; font: 600 12px sans-serif; text-transform: uppercase; }
main { padding: 24px 40px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.card { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px #0002; }
.card h2 { margin: 0 0 6px; color: #b0453a; font-size: 20px; }
</style></head><body><header><p>Four days in May</p><h1>Lisbon trip</h1></header><main>
<div class="card"><h2>Alfama</h2>Alleys, fado and the view from Santa Luzia.</div>
<div class="card"><h2>Belém</h2>The monastery, the tower and warm pastéis.</div>
<div class="card"><h2>Sintra</h2>A palace in every colour, on a hill in the fog.</div>
<div class="card"><h2>LX Factory</h2>Books, coffee and a Sunday market.</div>
</main></body></html>
"""


def find_chromium():
    base = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
    found = sorted(glob.glob(os.path.join(base, 'chromium_headless_shell-*', '*', 'headless_shell')))
    return found[-1] if found else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--chromium', default=find_chromium())
    args = ap.parse_args()
    root = os.path.join(args.out, 'Lisbon trip')
    os.makedirs(os.path.join(root, 'notes'), exist_ok=True)
    pic = os.path.join(root, 'tram-28.png')
    tram_picture(pic)
    with open(os.path.join(root, 'Plan.md'), 'w') as f:
        f.write(PLAN)
    # An earlier draft of the plan, to compare with.
    draft = (PLAN.replace('four days in May', 'a long weekend').replace('the flat in **Alfama** is paid', 'still looking for a flat')
             .replace('| Sat | Sintra: Pena palace | €70 |', '| Sat | Cascais beach | €50 |').replace('  C --> D[LX Factory]\n', ''))
    with open(os.path.join(root, 'notes', 'Plan (draft).md'), 'w') as f:
        f.write(draft)
    with open(os.path.join(root, 'notes', 'Packing.md'), 'w') as f:
        f.write(NOTE)
    guide_pdf(os.path.join(root, 'Lisbon guide.pdf'), pic, args.chromium)
    budget_xlsx(os.path.join(root, 'Budget.xlsx'))
    azulejo_svg(os.path.join(root, 'azulejo.svg'))
    song_wav(os.path.join(root, 'Fado sketch.wav'))
    clip_webm(os.path.join(root, 'Sunset.webm'), pic)
    shutil.copy(os.path.join(HERE, 'fixture-data', 'astronaut.jpg'), os.path.join(root, 'portrait.jpg'))
    shutil.copy(os.path.join(HERE, 'fixture-data', 'knot-draco.glb'), os.path.join(root, 'souvenir.glb'))
    itinerary_docx(os.path.join(root, 'Itinerary.docx'))
    with open(os.path.join(root, 'itinerary.json'), 'w') as f:
        json.dump(ITINERARY, f, indent=2, ensure_ascii=False)
    with open(os.path.join(root, 'trip.html'), 'w') as f:
        f.write(PAGE)
    # The photos as a zip, and checksums of everything (one line wrong would
    # show as a mismatch, so all are right).
    with zipfile.ZipFile(os.path.join(root, 'photos.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ('tram-28.png', 'portrait.jpg', 'azulejo.svg', 'Sunset.webm'):
            z.write(os.path.join(root, name), name)
    sums = []
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name)
        if os.path.isfile(p):
            sums.append(f'{hashlib.sha256(open(p, "rb").read()).hexdigest()}  {name}\n')
    with open(os.path.join(root, 'SHA256SUMS'), 'w') as f:
        f.writelines(sums)
    print(root)


if __name__ == '__main__':
    main()
