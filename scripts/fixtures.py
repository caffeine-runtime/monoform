#!/usr/bin/env python3
"""Create self-test fixtures: scripts/fixtures.py <dir>"""
import math
import os, sys, struct, zlib, shutil

d = sys.argv[1]
# Outputs written by earlier self-test runs; operations refuse to overwrite.
for rel in ("audio", "video", "pdf/out", "archives/out", "newfiles", "img/out", "img/subject (edited).png", "img/red (edited).png"):
    q = os.path.join(d, rel)
    if os.path.isdir(q): shutil.rmtree(q, ignore_errors=True)
    elif os.path.exists(q): os.remove(q)
os.makedirs(os.path.join(d, "enc"), exist_ok=True)
os.makedirs(os.path.join(d, "notes", "sub"), exist_ok=True)

def w(rel, data):
    p = os.path.join(d, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data)

# Encodings and line endings (round-trip set)
w("enc/utf8-lf.txt", "zażółć gęślą jaźń\nline 2\n".encode())
w("enc/utf8-crlf.txt", "first\r\nsecond\r\nthird".encode())
w("enc/utf8-mixed.txt", "a\r\nb\nc\rd\r\n".encode())
w("enc/utf8-bom.txt", b"\xef\xbb\xbfwith bom\n")
w("enc/utf16le.txt", "﻿UTF-16 tekst ż\r\n".encode("utf-16-le"))
w("enc/utf16be.txt", "﻿big endian\n".encode("utf-16-be"))
w("enc/cp1252.txt", "caf\xe9 \x80uro na\xefve\n".encode("latin-1"))
w("enc/cr-only.txt", b"old\rmac\rfile\r")
w("enc/empty.txt", b"")
w("enc/no-final-newline.go", b"package main\n\nfunc main() {}")
w("enc/bom-in-middle.txt", "a﻿b\n".encode())

# Markdown
w("notes/index.md", b"# Notes\n\nSee [the other note](sub/other.md) and [web](https://example.com).\n\n## Section\n\n- one\n- two\n")
w("notes/sub/other.md", b"# Other\n\nBack to [index](../index.md).\n")

# Search corpus
for i in range(200):
    w(f"corpus/file{i:03}.txt", (f"line one of {i}\nneedle in file {i}\n" if i % 10 == 0 else f"nothing here {i}\n").encode())

# A tiny PNG for paste tests
def png(wd, ht, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * wd for _ in range(ht))
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", wd, ht, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
w("img/red.png", png(40, 30, (220, 60, 40)))

def png_fn(wd, ht, fn):
    raw = b"".join(b"\x00" + b"".join(bytes(fn(x, y)) for x in range(wd)) for y in range(ht))
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", wd, ht, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

# Left half: 2px black/white stripes (blur makes them grey); right half: blue.
# Image editor v2: a red disc (subject) and a blue square on a light background.
def _subject(x, y):
    if (x - 200) ** 2 + (y - 150) ** 2 <= 80 ** 2:
        return (200, 30, 40)
    if 20 <= x < 80 and 20 <= y < 80:
        return (40, 80, 200)
    return (235, 232, 226)
w("img/subject.png", png_fn(400, 300, _subject))
w("img/photo.png", png_fn(400, 300, lambda x, y: (0, 0, 0) if x < 200 and (x // 2) % 2 == 0 else ((255, 255, 255) if x < 200 else (40, 80, 200))))
# A photo-like image (smooth gradients + texture): stored losslessly it compresses badly.
w("img/big.png", png_fn(1200, 900, lambda x, y: (int(128 + 90 * math.sin(x / 41)) , int(128 + 80 * math.cos(y / 29)), (x * 7 + y * 3) % 256)))
w("img/vector.svg", b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="12" fill="#d97757"/><circle cx="60" cy="40" r="22" fill="#fff"/></svg>')

def _cad_svg():
    """A technical drawing like CAD exports: layers of lines, dashed centre
    lines, polygons, a gear outline as one 1400-point polyline, text."""
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297">',
           '<style>text{font-family:sans-serif;fill:#000}</style><rect width="420" height="297" fill="#fff"/>',
           '<g id="frame" fill="none" stroke="#000" stroke-width="0.5"><polygon points="20,287 410,287 410,10 20,10"/></g>',
           '<g id="center" fill="none" stroke="#000" stroke-width="0.18" stroke-dasharray="6 1.5 1 1.5">']
    for i in range(160):
        x, y = 30 + (i * 37) % 360, 20 + (i * 53) % 250
        out.append(f'<line x1="{x}" y1="{y}" x2="{x + 9}" y2="{y + (i % 3) * 4}"/>')
    out.append('</g><g id="visible" fill="none" stroke="#000" stroke-width="0.35">')
    for i in range(70):
        x, y = 40 + (i * 29) % 330, 30 + (i * 41) % 220
        out.append(f'<polygon points="{x},{y} {x + 12},{y} {x + 12},{y + 7} {x},{y + 7}"/>')
    for g in range(4):
        cx, cy, pts = 120 + g * 60, 110 + (g % 2) * 60, []
        for k in range(1400 if g == 0 else 300):
            a = k / (1400 if g == 0 else 300) * 2 * math.pi
            r = 25 + 2.5 * (1 if (k // 25) % 2 else -1)
            pts.append(f"{cx + r * math.cos(a):.3f},{cy + r * math.sin(a):.3f}")
        out.append(f'<polyline points="{" ".join(pts)}"/>')
    for i in range(28):
        out.append(f'<circle cx="{60 + i * 12}" cy="250" r="{2 + i % 4}"/>')
    out.append('</g><g id="text">')
    for i in range(47):
        out.append(f'<text x="{30 + (i * 61) % 360}" y="{40 + (i * 23) % 230}" font-size="3.5">Ø{10 + i} H7</text>')
    out.append('</g></svg>')
    return "\n".join(out).encode()
w("img/cad-drawing.svg", _cad_svg())
# A 2-frame GIF (built by hand: 2x2 pixels, global palette of 2 colours). LZW: a clear
# code before every pixel keeps the code size at 3 bits.
def _lzw(pixels):
    codes = []
    for p in pixels:
        codes += [4, p]
    codes.append(5)
    bits = 0
    nbits = 0
    out = bytearray()
    for c in codes:
        bits |= c << nbits
        nbits += 3
        while nbits >= 8:
            out.append(bits & 255)
            bits >>= 8
            nbits -= 8
    if nbits:
        out.append(bits & 255)
    return bytes([2, len(out)]) + bytes(out) + b"\x00"
gif = (b"GIF89a\x02\x00\x02\x00\x80\x00\x00" + bytes([255, 0, 0, 0, 0, 255]) +
       b"!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00" +
       b"!\xf9\x04\x00\x0a\x00\x00\x00" + b",\x00\x00\x00\x00\x02\x00\x02\x00\x00" + _lzw([0, 1, 1, 0]) +
       b"!\xf9\x04\x00\x0a\x00\x00\x00" + b",\x00\x00\x00\x00\x02\x00\x02\x00\x00" + _lzw([1, 0, 0, 1]) + b";")
w("img/anim.gif", gif)

# PDFs
def pdf(pages, extra_objs=None, catalog_extra="", page_annots=None):
    """Minimal PDF: page i shows 'Page i'. extra_objs are appended objects (text)."""
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offs = []
    def obj(s):
        offs.append(len(out))
        out.extend(f"{len(offs)} 0 obj\n{s}\nendobj\n".encode("latin-1"))
    kids = " ".join(f"{4 + i * 2} 0 R" for i in range(pages))
    obj(f"<< /Type /Catalog /Pages 2 0 R {catalog_extra} >>")
    obj(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
    obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i in range(pages):
        annots = page_annots(i) if page_annots else ""
        obj(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + i * 2} 0 R {annots} >>")
        body = f"BT /F1 36 Tf 72 700 Td (Page {i + 1}) Tj ET BT /F1 12 Tf 72 660 Td (The quick brown fox jumps over the lazy dog. Searchable text on page {i + 1}.) Tj ET"
        obj(f"<< /Length {len(body)} >>\nstream\n{body}\nendstream")
    for e in extra_objs or []:
        obj(e)
    xref = len(out)
    out.extend(f"xref\n0 {len(offs) + 1}\n0000000000 65535 f \n".encode())
    for o in offs:
        out.extend(f"{o:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(offs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(out)

w("pdf/hundred.pdf", pdf(100))
w("pdf/three.pdf", pdf(3))
w("pdf/two.pdf", pdf(2))
# Page 2 is shown rotated 90° (signatures must land upright on it).
w("pdf/tools.pdf", pdf(3, None, "", lambda i: "/Rotate 90" if i == 1 else ""))
# Form: one text field and one checkbox on page 1 (objects 6 and 7 for a 1-page doc).
form_objs = [
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [72 600 372 624] /F 4 /DA (/Helv 12 Tf 0 g) /MK << /BC [0 0 0] >> /P 4 0 R >>",
    "<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /Rect [72 560 90 578] /F 4 /V /Off /AS /Off /MK << /BC [0 0 0] >> /P 4 0 R /AP << /N << /Yes 8 0 R /Off 9 0 R >> >> >>",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 18 18] /Length 30 >>\nstream\n0 0 m 18 18 l 18 0 m 0 18 l S\nendstream",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 18 18] /Length 0 >>\nstream\n\nendstream",
]
w("pdf/form.pdf", pdf(1, form_objs, "/AcroForm << /Fields [6 0 R 7 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >> >>", lambda i: "/Annots [6 0 R 7 0 R]"))

# Data
w("data/sample.json", b'{\n  "name": "Monoform",\n  "version": 1,\n  "tags": ["fast", "calm"],\n  "nested": {"deep": {"list": [1, 2, {"x key": true}]}},\n  "nothing": null\n}\n')
w("data/invalid.json", b'{\n  "a": 1,\n  "b": [1, 2,\n  "c": "missing bracket"\n}\n')
w("data/sample.yaml", b"# config\nname: Monoform\nports:\n  - 80\n  - 443\nowner:\n  name: Ann\n  active: true\n")
w("data/invalid.yaml", b"name: ok\nlist:\n  - a\n - b\n")
w("data/semi.csv", 'name;city;amount\r\n"Kowalski; Jan";Kraków;12,50\r\nAnn;"Paris\r\nFrance";7\r\nBob;Rome;100\r\n'.encode())
# Spreadsheet-behaviour fixtures (selection, paste, fill, move, AutoComplete).
w("data/grid.csv", b"name,city,qty\nAnna,Warsaw,1\nBartek,Wroclaw,2\nCelina,Berlin,3\nDawid,Warsaw,4\n")
big_csv = os.path.join(d, "data", "million.csv")
if not os.path.exists(big_csv):
    cities = ["Krakow", "Paris", "Rome", "Lisbon", "Oslo", "Tallinn", "Porto", "Gdansk"]
    with open(big_csv, "w", newline="") as f:
        f.write("id,name,city,amount,date\n")
        for i in range(1, 1_000_001):
            f.write(f"{i},user{(i * 7919) % 1000003},{cities[i % 8]},{(i * 37) % 100000 / 100:.2f},2026-{1 + i % 12:02}-{1 + i % 28:02}\n")

# Office documents (generated by scripts/office/make-fixtures.sh with LibreOffice)
import shutil
here = os.path.dirname(os.path.abspath(__file__))
td = os.path.join(here, "..", "internal", "office", "testdata")
os.makedirs(os.path.join(d, "office"), exist_ok=True)
for src, dst in [("doc.docx", "report.docx"), ("doc.doc", "legacy.doc"), ("sheet.xlsx", "budget.xlsx"), ("sheet.xls", "legacy.xls"), ("sheet.xlsx", "grid.xlsx"), ("doc.odt", "notes.odt"), ("sheet.ods", "budget.ods")]:
    shutil.copyfile(os.path.join(td, src), os.path.join(d, "office", dst))
for stale in ("legacy.docx", "legacy.xlsx"):
    p = os.path.join(d, "office", stale)
    if os.path.exists(p):
        os.remove(p)

# Archives
import zipfile, tarfile, io, binascii
os.makedirs(os.path.join(d, "archives"), exist_ok=True)
def zadd(z, name, data, mode=0o644):
    zi = zipfile.ZipInfo(name, date_time=(2026, 10, 19, 12, 0, 0))
    zi.external_attr = (mode & 0xFFFF) << 16
    zi.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(zi, data)
with zipfile.ZipFile(os.path.join(d, "archives", "sample.zip"), "w") as z:
    zadd(z, "docs/readme.md", b"# Inside a zip\n\nHello from the archive.\n")
    zadd(z, "docs/deep/data.csv", b"a,b\n1,2\n")
    zadd(z, "img/red.png", png(40, 30, (220, 60, 40)))
    zadd(z, "top.txt", b"top level\n")
with tarfile.open(os.path.join(d, "archives", "sample.tar.gz"), "w:gz") as t:
    for name, data in [("project/main.go", b"package main\n"), ("project/notes.txt", b"notes\n")]:
        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = 1792400000
        t.addfile(ti, io.BytesIO(data))
shutil.copyfile(os.path.join(here, "..", "internal", "archive", "testdata", "sample.7z"), os.path.join(d, "archives", "sample.7z"))
def rar5(files):
    def vint(v):
        out = bytearray()
        while True:
            b = v & 0x7F; v >>= 7
            if v: out.append(b | 0x80)
            else:
                out.append(b); return bytes(out)
    def block(fields, data=b""):
        hdr = vint(len(fields)) + fields
        return binascii.crc32(hdr).to_bytes(4, "little") + hdr + data
    out = b"Rar!\x1a\x07\x01\x00" + block(vint(1) + vint(0) + vint(0))
    for name, body in files:
        nb = name.encode()
        f = vint(2) + vint(2) + vint(len(body)) + vint(4) + vint(len(body)) + vint(0x20) + binascii.crc32(body).to_bytes(4, "little") + vint(0) + vint(1) + vint(len(nb)) + nb
        out += block(f, body)
    return out + block(vint(5) + vint(0) + vint(0))
w("archives/sample.rar", rar5([("music/list.txt", b"rar entry\n"), ("readme.txt", b"hello rar\n")]))
with zipfile.ZipFile(os.path.join(d, "archives", "slip.zip"), "w") as z:
    zadd(z, "../escaped.txt", b"should not escape")
    zadd(z, "/absolute.txt", b"nope")
    zadd(z, "safe/ok.txt", b"ok")
    zadd(z, "safe/link", b"../../../../etc/passwd", 0o120777)
for stale in ("escaped.txt",):
    p = os.path.join(d, stale)
    if os.path.exists(p):
        os.remove(p)

# Hashing
import hashlib
w("hash/abc.txt", b"abc")
w("hash/empty.txt", b"")
w("hash/SHA256SUMS", (hashlib.sha256(b"abc").hexdigest() + "  abc.txt\n" + hashlib.sha256(b"").hexdigest() + " *empty.txt\n" + "0" * 64 + "  abc.txt\n" + hashlib.sha256(b"x").hexdigest() + "  missing.bin\n").encode())
w("hash/files.md5", (hashlib.md5(b"abc").hexdigest() + "  abc.txt\n").encode())
big = os.path.join(d, "hash", "big.bin")
if not os.path.exists(big):
    with open(big, "wb") as f:
        f.truncate(3 * 1024 * 1024 * 1024)  # sparse 3 GiB

# Search by meaning: topics whose wording doesn't overlap the test queries.
shutil.rmtree(os.path.join(d, "meaning"), ignore_errors=True)
w("meaning/aurora.md", b"""# Polar lights

Charged particles streaming from the sun collide with oxygen and nitrogen high in
the atmosphere. Near the magnetic poles these collisions make curtains of green
and red light ripple across the dark winter sky.
""")
w("meaning/sourdough.md", b"""# Bread notes

Feed the starter the evening before. Mix flour, water and salt, fold the dough
every half hour, then let it proof slowly in the fridge overnight before baking
in a very hot dutch oven.
""")
w("meaning/server.go", b"""package main

import "net/http"

// main answers every request with a greeting.
func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("hi")) })
	http.ListenAndServe(":8080", nil)
}
""")
w("meaning/garden.txt", b"""Plant tomato seedlings after the last frost, about sixty centimetres apart.
Water deeply twice a week and tie the stems to stakes as the fruit gets heavy.
""")
w("meaning/invoice.txt", b"""Invoice 2026-114. Consulting services, 12 hours at 95 EUR. Payment due within
30 days to the bank account below. VAT reverse charge applies.
""")
w("meaning/cats.md", b"""# Our cat

Miso sleeps most of the day on the radiator, purrs loudly and insists on
breakfast at five in the morning.
""")
w("meaning/package-lock.json", b'{"lockfileVersion": 3}')
w("meaning/notes.md", ("""# Mixed notes

Roman engineers carried water into their cities over long stone channels. The
channels dropped only a few centimetres per kilometre, crossed valleys on tall
arched bridges, and fed public fountains, baths and private houses. Lead pipes
spread the water inside the walls, and keepers inspected the channels for leaks
and for illegal taps by farmers along the route. Many of the arches still stand.

In the year 79 the mountain above the bay erupted. Ash and pumice buried the
towns at its foot for centuries, preserving bread in ovens, graffiti on walls
and the hollow shapes of people caught in the fall. Excavations began in the
eighteenth century and are still going on, with new rooms and frescoes found
almost every year by the archaeologists working at the site today.

White should fight for the centre from the first move. Develop the knights
before the bishops, castle early to keep the king safe, and avoid moving the
same piece twice before every piece is out. Do not bring the queen out too
soon, where she can be chased around by smaller pieces while the opponent
develops with tempo. Connect the rooks once the minor pieces are developed.
""").encode())

# HTML page with relative resources, a script, a remote image and links.
w("web/index.html", b"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixture page</title>
  <link rel="stylesheet" href="style.css">
  <script src="script.js"></script>
</head>
<body>
  <h1 id="h">Hello from a local page</h1>
  <img src="img/pic.png" alt="local picture" width="40" height="30">
  <img src="https://example.com/remote.png" alt="remote picture">
  <p><a href="page2.html">Next page</a> and <a href="https://example.com/">an external site</a>.</p>
</body>
</html>
""")
w("web/style.css", b"body { background: #ffeecc; font-family: serif; } h1 { color: #aa2200; }")
w("web/script.js", b"document.addEventListener('DOMContentLoaded', () => { document.getElementById('h').textContent = 'Script ran'; });")
w("web/img/pic.png", png(40, 30, (30, 120, 220)))
w("web/page2.html", b"<!doctype html><title>Second</title><p>Second page</p>")

# ---- 3D models ----
import json as _json, math as _math
def _cube():
    # 24 vertices (flat normals, per-face UVs), 36 indices.
    faces = [((1,0,0),(0,1,0)),((-1,0,0),(0,1,0)),((0,1,0),(0,0,-1)),((0,-1,0),(0,0,1)),((0,0,1),(0,1,0)),((0,0,-1),(0,1,0))]
    pos, nor, uv, idx = [], [], [], []
    for n, up in faces:
        n = list(n); up = list(up)
        r = [up[1]*n[2]-up[2]*n[1], up[2]*n[0]-up[0]*n[2], up[0]*n[1]-up[1]*n[0]]
        base = len(pos)
        for su, sv in ((-1,-1),(1,-1),(1,1),(-1,1)):
            pos.append([n[k] * 0.5 + r[k] * 0.5 * su + up[k] * 0.5 * sv for k in range(3)])
            nor.append(n); uv.append([(su + 1) / 2, 1 - (sv + 1) / 2])
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, nor, uv, idx

def _glb():
    pos, nor, uv, idx = _cube()
    tex = png_fn(64, 64, lambda x, y: (220, 90, 60) if (x // 16 + y // 16) % 2 == 0 else (245, 235, 220))
    buf = bytearray(); views = []
    def add(data, target=None):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target: v["target"] = target
        views.append(v); return len(views) - 1
    f32 = lambda arr: struct.pack("<%df" % len(arr), *arr)
    flat = lambda a: [c for v in a for c in v]
    vp = add(f32(flat(pos)), 34962); vn = add(f32(flat(nor)), 34962); vt = add(f32(flat(uv)), 34962)
    vi = add(struct.pack("<%dH" % len(idx), *idx), 34963)
    vimg = add(tex)
    # Two clips: "Spin" (rotation, 2 s) and "Bounce" (translation, 1 s).
    t_spin = [0, 0.5, 1, 1.5, 2]
    q = lambda a: [0, _math.sin(a / 2), 0, _math.cos(a / 2)]
    r_spin = flat([q(_math.pi * t) for t in t_spin])
    t_b = [0, 0.5, 1]
    tr_b = flat([[0, 0, 0], [0, 0.6, 0], [0, 0, 0]])
    a_ts = add(f32(t_spin)); a_rs = add(f32(r_spin)); a_tb = add(f32(t_b)); a_trb = add(f32(tr_b))
    acc = [
        {"bufferView": vp, "componentType": 5126, "count": 24, "type": "VEC3", "min": [-0.5,-0.5,-0.5], "max": [0.5,0.5,0.5]},
        {"bufferView": vn, "componentType": 5126, "count": 24, "type": "VEC3"},
        {"bufferView": vt, "componentType": 5126, "count": 24, "type": "VEC2"},
        {"bufferView": vi, "componentType": 5123, "count": 36, "type": "SCALAR"},
        {"bufferView": a_ts, "componentType": 5126, "count": 5, "type": "SCALAR", "min": [0], "max": [2]},
        {"bufferView": a_rs, "componentType": 5126, "count": 5, "type": "VEC4"},
        {"bufferView": a_tb, "componentType": 5126, "count": 3, "type": "SCALAR", "min": [0], "max": [1]},
        {"bufferView": a_trb, "componentType": 5126, "count": 3, "type": "VEC3"},
    ]
    gltf = {
        "asset": {"version": "2.0", "generator": "monoform fixtures"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "Cube", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"name": "Checker", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.8}}],
        "textures": [{"source": 0}], "images": [{"bufferView": vimg, "mimeType": "image/png"}],
        "accessors": acc, "bufferViews": views, "buffers": [{"byteLength": 0}],
        "animations": [
            {"name": "Spin", "samplers": [{"input": 4, "output": 5}], "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}}]},
            {"name": "Bounce", "samplers": [{"input": 6, "output": 7}], "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}]},
        ],
    }
    while len(buf) % 4: buf.append(0)
    gltf["buffers"][0]["byteLength"] = len(buf)
    js = _json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(buf), 0x004E4942) + bytes(buf)
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
w("models/animated.glb", _glb())

def _spheres():
    # Three PBR spheres (gold metal, glossy plastic, rough clay) for checking
    # reflections and lighting.
    seg, ring = 48, 24
    pos, nor, idx = [], [], []
    for j in range(ring + 1):
        v = j / ring; th = v * _math.pi
        for i in range(seg + 1):
            ph = i / seg * 2 * _math.pi
            n = [_math.sin(th) * _math.cos(ph), _math.cos(th), _math.sin(th) * _math.sin(ph)]
            pos.append([c * 0.5 for c in n]); nor.append(n)
    for j in range(ring):
        for i in range(seg):
            a = j * (seg + 1) + i; b = a + seg + 1
            idx += [a, b, a + 1, b, b + 1, a + 1]
    flat = lambda a: [c for v in a for c in v]
    pb = struct.pack("<%df" % (len(pos) * 3), *flat(pos)); nb = struct.pack("<%df" % (len(nor) * 3), *flat(nor))
    ib = struct.pack("<%dH" % len(idx), *idx)
    buf = pb + nb + ib
    mats = [("Gold", [1.0, 0.77, 0.34, 1], 1.0, 0.25), ("Plastic", [0.75, 0.12, 0.1, 1], 0.0, 0.2), ("Clay", [0.55, 0.62, 0.7, 1], 0.0, 0.9)]
    gltf = {
        "asset": {"version": "2.0", "generator": "monoform fixtures"},
        "scene": 0, "scenes": [{"nodes": [0, 1, 2]}],
        "nodes": [{"name": m[0], "mesh": k, "translation": [(k - 1) * 1.2, 0.5, 0]} for k, m in enumerate(mats)],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": k}]} for k in range(3)],
        "materials": [{"name": m[0], "pbrMetallicRoughness": {"baseColorFactor": m[1], "metallicFactor": m[2], "roughnessFactor": m[3]}} for m in mats],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": [-0.5, -0.5, -0.5], "max": [0.5, 0.5, 0.5]},
            {"bufferView": 1, "componentType": 5126, "count": len(nor), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5123, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
            {"buffer": 0, "byteOffset": len(pb), "byteLength": len(nb), "target": 34962},
            {"buffer": 0, "byteOffset": len(pb) + len(nb), "byteLength": len(ib), "target": 34963},
        ],
        "buffers": [{"byteLength": len(buf)}],
    }
    buf = bytearray(buf)
    while len(buf) % 4: buf.append(0)
    js = _json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(buf), 0x004E4942) + bytes(buf)
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
w("models/spheres.glb", _spheres())
# Draco-compressed glTF (generated once by fixture-data/knot-draco.mjs).
w("models/knot-draco.glb", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture-data", "knot-draco.glb"), "rb").read())

# ---- audio ----
def _wav(frames_bytes, rate, ch):
    n = len(frames_bytes)
    return (b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, ch, rate, rate * ch * 2, ch * 2, 16)
            + b"data" + struct.pack("<I", n) + frames_bytes)
def _tones():
    # 3 s, 48 kHz stereo: 440 Hz at 0.5, 880 Hz at 0.25, 220 Hz at 0.5; right channel at half level.
    rate, out = 48000, bytearray()
    for f, a in ((440, 0.5), (880, 0.25), (220, 0.5)):
        for i in range(rate):
            v = a * _math.sin(2 * _math.pi * f * i / rate)
            out += struct.pack("<hh", int(round(v * 32767)), int(round(v * 16383)))
    return _wav(bytes(out), rate, 2)
w("audio/tones.wav", _tones())
# 10 minutes, mono 22.05 kHz (one second repeated): for open time and UI frames.
_sec = b"".join(struct.pack("<h", int(12000 * _math.sin(2 * _math.pi * 330 * i / 22050))) for i in range(22050))
w("audio/long.wav", _wav(_sec * 600, 22050, 1))
_here = os.path.dirname(os.path.abspath(__file__))
for _f in ("tone.mp3", "tone.flac", "tone.ogg", "tone.opus"):
    w("audio/" + _f, open(os.path.join(_here, "..", "internal", "audio", "testdata", _f), "rb").read())
w("audio/tone.m4a", open(os.path.join(_here, "fixture-data", "tone.m4a"), "rb").read())
# A real photo of a person for object selection: NASA portrait of astronaut Eileen Collins
# (public domain, a work of the US government; scikit-image's `data.astronaut()`), JPEG 512×512.
w("people/astronaut.jpg", open(os.path.join(_here, "fixture-data", "astronaut.jpg"), "rb").read())

# ---- code editor (M18): symbols, indentation, repeated words, enough lines to scroll ----
_code = ["// Sample module for the code editor test.", "export function parseRecord(line: string): Record {",
         "  const parts = line.split(',');", "  if (parts.length < 2) {", "    throw new Error('short record');", "  }",
         "  return { name: parts[0], amount: Number(parts[1]) };", "}", "", "export class Ledger {",
         "  private records: Record[] = [];", "  addRecord(r: Record) {", "    this.records.push(r);", "  }",
         "  totalAmount(): number {", "    return this.records.reduce((n, r) => n + r.amount, 0);", "  }", "}",
         "", "interface Record {", "  name: string;", "  amount: number;", "}", ""]
_code += [f"export const value{i} = {i} * 2; // filler line {i}" for i in range(200)]
w("code/sample.ts", "\n".join(_code).encode())

# ---- database (M19): SQLite file with tables, a view, an index, a trigger and 100k rows ----
def _shopdb():
    import sqlite3, tempfile
    tmp = os.path.join(tempfile.mkdtemp(), "shop.db")
    con = sqlite3.connect(tmp)
    con.executescript("""
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, balance REAL DEFAULT 0);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer INTEGER REFERENCES customers(id), item TEXT, qty INTEGER);
      CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
      CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT, kind TEXT);
      CREATE INDEX idx_orders_customer ON orders(customer);
      CREATE VIEW big_spenders AS SELECT name, balance FROM customers WHERE balance > 500;
      CREATE TABLE audit (msg TEXT);
      CREATE TRIGGER t_customers AFTER UPDATE ON customers BEGIN INSERT INTO audit VALUES ('changed ' || new.name); END;
    """)
    cities = ["Warsaw", "Berlin", "Paris", "Lisbon", None]
    con.executemany("INSERT INTO customers (name, city, balance) VALUES (?, ?, ?)",
                    [(f"Customer {i:04d}", cities[i % 5], (i * 37) % 1000) for i in range(1, 1001)])
    con.executemany("INSERT INTO orders (customer, item, qty) VALUES (?, ?, ?)", [((i % 500) + 1, f"item {i % 17}", i % 9 + 1) for i in range(3000)])
    con.execute("INSERT INTO settings VALUES ('currency', 'EUR')")
    con.executemany("INSERT INTO events (at, kind) VALUES (?, ?)", [(f"2026-01-01T00:{i // 60 % 60:02d}:{i % 60:02d}", ["open", "save", "close"][i % 3]) for i in range(100000)])
    con.commit()
    con.close()
    with open(tmp, "rb") as f:
        return f.read()
w("db/shop.db", _shopdb())

# ---- video (small clips made with ffmpeg; see internal/video/testdata) ----
for _f in ("clip.webm", "clip.mp4", "h264.mp4", "clip.mkv", "track.webm"):
    w("video/" + _f, open(os.path.join(_here, "..", "internal", "video", "testdata", _f), "rb").read())

# ---- CAD drawings (DXF) ----
def _dxf(groups, eol="\n", pad=False):
    out = []
    for c, v in groups:
        out.append(f"{c:>3}" if pad else str(c))
        out.append(str(v))
    return (eol.join(out) + eol).encode("cp1252")

def _plan():
    g = [(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1015"), (9, "$DWGCODEPAGE"), (3, "ANSI_1252"),
         (9, "$INSUNITS"), (70, 4), (9, "$HANDSEED"), (5, "2000"), (0, "ENDSEC"),
         (0, "SECTION"), (2, "TABLES"), (0, "TABLE"), (2, "LAYER"), (5, "2"), (100, "AcDbSymbolTable"), (70, 4)]
    for h, name, color in (("10", "0", 7), ("11", "Walls", 1), ("12", "Furniture", 3), ("13", "Notes", 5), ("14", "Hidden", -8)):
        g += [(0, "LAYER"), (5, h), (100, "AcDbSymbolTableRecord"), (100, "AcDbLayerTableRecord"), (2, name), (70, 0), (62, color), (6, "CONTINUOUS")]
    g += [(0, "ENDTAB"), (0, "TABLE"), (2, "BLOCK_RECORD"), (5, "1"), (70, 2),
          (0, "BLOCK_RECORD"), (5, "1F"), (2, "*Model_Space"), (0, "BLOCK_RECORD"), (5, "20"), (2, "Chair"), (0, "ENDTAB"), (0, "ENDSEC")]
    # A chair block: seat square and a back arc (BYBLOCK colour).
    g += [(0, "SECTION"), (2, "BLOCKS"), (0, "BLOCK"), (5, "30"), (8, "0"), (2, "Chair"), (70, 0), (10, 0.0), (20, 0.0), (30, 0.0), (3, "Chair"),
          (0, "LWPOLYLINE"), (5, "31"), (100, "AcDbEntity"), (8, "0"), (62, 0), (100, "AcDbPolyline"), (90, 4), (70, 1),
          (10, -200.0), (20, -200.0), (10, 200.0), (20, -200.0), (10, 200.0), (20, 200.0), (10, -200.0), (20, 200.0),
          (0, "ARC"), (5, "32"), (100, "AcDbEntity"), (8, "0"), (62, 0), (100, "AcDbCircle"), (10, 0.0), (20, 0.0), (30, 0.0), (40, 260.0), (100, "AcDbArc"), (50, 45.0), (51, 135.0),
          (0, "ENDBLK"), (5, "33"), (8, "0"), (0, "ENDSEC")]
    E = [(0, "SECTION"), (2, "ENTITIES")]
    hd = [0x100]
    def ent(t, layer, *rest, sub=()):
        hd[0] += 1
        e = [(0, t), (5, format(hd[0], "X")), (330, "1F"), (100, "AcDbEntity"), (8, layer)]
        for s in sub:
            e.append((100, s)) if isinstance(s, str) else e.append(s)
        return e + list(rest)
    # Outer walls: a closed polyline 10 m × 6 m (mm), inner wall lines.
    E += ent("LWPOLYLINE", "Walls", (90, 4), (70, 1), (43, 0.0), (10, 0.0), (20, 0.0), (10, 10000.0), (20, 0.0), (10, 10000.0), (20, 6000.0), (10, 0.0), (20, 6000.0), sub=["AcDbPolyline"])
    E += ent("LINE", "Walls", (10, 6000.0), (20, 0.0), (30, 0.0), (11, 6000.0), (21, 6000.0), (31, 0.0), sub=["AcDbLine"])
    E += ent("LINE", "Walls", (10, 0.0), (20, 3000.0), (30, 0.0), (11, 4000.0), (21, 3000.0), (31, 0.0), sub=["AcDbLine"])
    # A table (circle), a door swing (arc with bulged polyline) and a spline.
    E += ent("CIRCLE", "Furniture", (10, 8000.0), (20, 3000.0), (30, 0.0), (40, 600.0), sub=["AcDbCircle"])
    E += ent("ARC", "Walls", (10, 6000.0), (20, 1000.0), (30, 0.0), (40, 900.0), (50, 90.0), (51, 180.0), sub=["AcDbCircle", "AcDbArc"])
    E += ent("LWPOLYLINE", "Furniture", (90, 3), (70, 0), (10, 1000.0), (20, 4000.0), (42, 1.0), (10, 2000.0), (20, 4000.0), (10, 2500.0), (20, 5000.0), sub=["AcDbPolyline"])
    E += ent("SPLINE", "Notes", (210, 0.0), (220, 0.0), (230, 1.0), (70, 8), (71, 3), (72, 8), (73, 4), (74, 0),
             (40, 0.0), (40, 0.0), (40, 0.0), (40, 0.0), (40, 1.0), (40, 1.0), (40, 1.0), (40, 1.0),
             (10, 500.0), (20, 500.0), (30, 0.0), (10, 1500.0), (20, 2500.0), (30, 0.0), (10, 2500.0), (20, -500.0), (30, 0.0), (10, 3500.0), (20, 1500.0), (30, 0.0), sub=["AcDbSpline"])
    # Four chairs around the table (INSERTs, BYBLOCK colour green / blue).
    for i, (x, y, r) in enumerate(((8000, 2100, 0), (8900, 3000, 90), (8000, 3900, 180), (7100, 3000, 270))):
        E += ent("INSERT", "Furniture", (62, 3 if i % 2 else 5), (2, "Chair"), (10, float(x)), (20, float(y)), (30, 0.0), (50, float(r)), sub=["AcDbBlockReference"])
    # Texts (one with a cp1252 character), MTEXT, a solid hatch, a point.
    E += ent("TEXT", "Notes", (10, 500.0), (20, 5500.0), (30, 0.0), (40, 250.0), (1, "Living room – 60 m²"), sub=["AcDbText"]) + [(100, "AcDbText")]
    E += ent("MTEXT", "Notes", (10, 6500.0), (20, 5500.0), (30, 0.0), (40, 200.0), (41, 3000.0), (71, 1), (1, "Kitchen\\Pnorth side"), sub=["AcDbMText"])
    E += ent("HATCH", "Furniture", (10, 0.0), (20, 0.0), (30, 0.0), (210, 0.0), (220, 0.0), (230, 1.0), (2, "SOLID"), (70, 1), (71, 0), (91, 1),
             (92, 2), (72, 0), (73, 1), (93, 4), (10, 9000.0), (20, 500.0), (10, 9800.0), (20, 500.0), (10, 9800.0), (20, 1200.0), (10, 9000.0), (20, 1200.0), (97, 0),
             (75, 0), (76, 1), (98, 1), (10, 9400.0), (20, 800.0), sub=["AcDbHatch"])
    E += ent("POINT", "Notes", (10, 5000.0), (20, 5000.0), (30, 0.0), sub=["AcDbPoint"])
    E += ent("LINE", "Hidden", (10, 0.0), (20, 0.0), (30, 0.0), (11, 10000.0), (21, 6000.0), (31, 0.0), sub=["AcDbLine"])
    E += [(0, "ENDSEC"), (0, "SECTION"), (2, "OBJECTS"), (0, "DICTIONARY"), (5, "C"), (330, "0"), (100, "AcDbDictionary"), (3, "ACAD_GROUP"), (350, "D"),
          (0, "DICTIONARY"), (5, "D"), (330, "C"), (100, "AcDbDictionary"), (0, "ENDSEC"), (0, "EOF")]
    return _dxf(g + E, eol="\r\n")
w("cad/plan.dxf", _plan())

# R12: right-aligned codes, POLYLINE/VERTEX/SEQEND, no handles.
w("cad/r12.dxf", _dxf([(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1009"), (0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES"),
    (0, "POLYLINE"), (8, "0"), (66, 1), (10, 0.0), (20, 0.0), (30, 0.0), (70, 1),
    (0, "VERTEX"), (8, "0"), (10, 0.0), (20, 0.0), (30, 0.0), (0, "VERTEX"), (8, "0"), (10, 100.0), (20, 0.0), (30, 0.0),
    (0, "VERTEX"), (8, "0"), (10, 100.0), (20, 50.0), (30, 0.0), (0, "SEQEND"), (8, "0"),
    (0, "CIRCLE"), (8, "PARTS"), (62, 1), (10, 50.0), (20, 25.0), (30, 0.0), (40, 10.0),
    (0, "ENDSEC"), (0, "EOF")], pad=True))

# A big drawing for speed: 40k lines, 10k circles, 2k texts.
def _bigdxf():
    g = [(0, "SECTION"), (2, "HEADER"), (9, "$ACADVER"), (1, "AC1009"), (0, "ENDSEC"), (0, "SECTION"), (2, "ENTITIES")]
    for i in range(40000):
        x, y = (i % 200) * 50.0, (i // 200) * 50.0
        g += [(0, "LINE"), (8, f"L{i % 8}"), (10, x), (20, y), (11, x + 40.0), (21, y + 30.0)]
    for i in range(10000):
        g += [(0, "CIRCLE"), (8, "C"), (62, i % 7 + 1), (10, (i % 100) * 100.0 + 25), (20, (i // 100) * 100.0 + 25), (40, 18.0)]
    for i in range(2000):
        g += [(0, "TEXT"), (8, "T"), (10, (i % 40) * 250.0), (20, (i // 40) * 200.0), (40, 20.0), (1, f"P{i}")]
    g += [(0, "ENDSEC"), (0, "EOF")]
    return _dxf(g)
w("cad/big.dxf", _bigdxf())

# ---- compare pairs ----
_code_a = """import { sum } from './math';

export function total(items: number[]): number {
  let t = 0;
  for (const i of items) t += i;
  return t * 2;
}

export const name = 'cart';
""" + "".join(f"export const c{i} = {i};\n" for i in range(60))
_code_b = _code_a.replace("return t * 2;", "return t * 3;").replace("export const name = 'cart';\n", "").replace("export const c30 = 30;\n", "export const c30 = 30;\nexport const extra = true;\n").replace("  let t = 0;", "    let t = 0;")
w("compare/a.ts", _code_a.encode())
w("compare/b.ts", _code_b.encode())
w("compare/a.json", b'{"name": "app", "version": "1.0.0", "deps": {"x": "^1", "y": "^2"}, "tags": ["a", "b"]}\n')
w("compare/b.json", b'{\n  "version": "1.1.0",\n  "name": "app",\n  "deps": {"x": "^1", "z": "^3"},\n  "tags": ["a", "c"]\n}\n')
w("compare/a.csv", b"id,name,city\n1,Ann,Berlin\n2,Bob,Paris\n3,Cid,Rome\n")
w("compare/b.csv", b"id,name,city\n3,Cid,Roma\n1,Ann,Berlin\n4,Dee,Oslo\n")
w("compare/a.png", png(64, 48, (40, 120, 200)))
w("compare/b.png", png_fn(64, 48, lambda x, y: (250, 40, 40) if 10 <= x < 20 and 5 <= y < 15 else (40, 120, 200)))
w("compare/a.bin", bytes(range(256)) * 64)
w("compare/b.bin", bytes(range(256)) * 32 + b"\xff" + bytes(range(1, 256)) + bytes(range(256)) * 31)
_big = [f"line {i}: value {i * 7 % 1000}" for i in range(100000)]
w("compare/big-a.txt", ("\n".join(_big) + "\n").encode())
for _i in range(50):
    _big[_i * 1999 + 7] = f"line changed {_i}"
w("compare/big-b.txt", ("\n".join(_big) + "\n").encode())

# ---- more data formats and logs ----
w("data/catalog.xml", b"""<?xml version="1.0" encoding="UTF-8"?>
<!-- books -->
<catalog lang="en">
  <book id="1"><title>Tom &amp; Jerry</title><price>9.5</price></book>
  <book id="2"><title><![CDATA[<b>Bold</b>]]></title><price>12</price></book>
</catalog>
""")
w("data/config.toml", b"""title = "Monoform"
[server]
port = 8080
hosts = ["a", "b"]
started = 2026-10-20T12:00:00Z
[[users]]
name = "ann"
[[users]]
name = "bob"
""")
w("data/events.jsonl", "".join(_json.dumps({"id": i, "kind": ["open", "save", "close"][i % 3], "ms": i * 7 % 500, **({"extra": {"n": i}} if i % 10 == 0 else {})}) + "\n" for i in range(5000)).encode())
w("data/people.json", _json.dumps([{"name": f"P{i}", "age": 20 + i % 50, "city": ["Berlin", "Paris"][i % 2]} for i in range(300)]).encode())
_log = []
for i in range(3000):
    lv = ["INFO", "INFO", "DEBUG", "WARN", "INFO", "ERROR"][i % 6]
    _log.append(f"2026-10-20T12:{i // 60 % 60:02d}:{i % 60:02d}Z {lv} [svc-{i % 4}] event {i} done")
    if lv == "ERROR":
        _log.append("java.lang.IllegalStateException: boom")
        _log.append("    at com.example.Main.run(Main.java:42)")
_log.append('time="2026-10-20T13:00:00Z" level=fatal msg="disk full"')
w("logs/app.log", ("\n".join(_log) + "\n").encode())

# ---- more image formats (M24): HEIC (made once with libheif; see internal/imaging/testdata), fonts ----
w("img/sample.heic", open(os.path.join(_here, "..", "internal", "imaging", "testdata", "sample.heic"), "rb").read())
for _f in ("test.ttf", "test.woff"):
    w("fonts/" + _f, open(os.path.join(_here, "..", "frontend", "src", "modules", "font", "testdata", _f), "rb").read())

# ---- config files and certificates (M25) ----
w("config/app.ini", b"; app\n[server]\nhost = localhost ; inline\nport = 8080\n[database]\nurl = \"postgres://db/app\"\nport=1\nport = 2\n")
w("config/.env", b"# local\nexport APP_NAME=demo\nDB_PASSWORD=hunter2\nAPI_TOKEN=\"abc def\"\nDEBUG=true\n")
w("config/app.properties", b"# props\ngreeting = Hello\\u0020World\nlong = one \\\n   two\n")
import subprocess, tempfile as _tf
def _openssl(*args, cwd):
    subprocess.run(["openssl", *args], cwd=cwd, check=True, capture_output=True)
try:
    _cd = _tf.mkdtemp()
    _openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "3650", "-subj", "/CN=Mf Test CA/O=Monoform/C=PL", cwd=_cd)
    _openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "site.key", "-out", "site.csr", "-subj", "/CN=www.mf.test", "-addext", "subjectAltName=DNS:www.mf.test,DNS:mf.test", cwd=_cd)
    open(os.path.join(_cd, "ext.cnf"), "w").write("subjectAltName=DNS:www.mf.test,DNS:mf.test\nextendedKeyUsage=serverAuth\n")
    _openssl("x509", "-req", "-in", "site.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "site.pem", "-days", "10", "-extfile", "ext.cnf", cwd=_cd)
    _openssl("pkcs12", "-export", "-inkey", "site.key", "-in", "site.pem", "-certfile", "ca.pem", "-out", "site.p12", "-passout", "pass:mf-pw", cwd=_cd)
    _openssl("x509", "-in", "site.pem", "-outform", "DER", "-out", "site.cer", cwd=_cd)
    rd = lambda f: open(os.path.join(_cd, f), "rb").read()
    w("certs/chain.pem", rd("site.pem") + rd("ca.pem"))
    w("certs/site.cer", rd("site.cer"))
    w("certs/site.csr", rd("site.csr"))
    w("certs/site.p12", rd("site.p12"))
except (OSError, subprocess.CalledProcessError) as _e:
    print("skipping certificate fixtures:", _e, file=sys.stderr)

# ---- diagrams (M28) ----
w("diagrams/build.dot", b"""// build pipeline
digraph "Build" {
  rankdir=LR; node [shape=box, style="rounded,filled", fillcolor="#eef"]
  edge [color=gray40]
  subgraph cluster_src {
    label = "Sources"; style=dashed
    lexer; parser [label="Parser\\n(LL)"]
  }
  lexer -> parser -> { checker emit } [label="ast"]
  emit -> "out.o" [arrowhead=vee, style=bold]
  checker -> lexer [dir=back]
  "out.o" [shape=cylinder]
}
""")
w("diagrams/flow.mmd", b"""flowchart TD
  A[Open a file] --> B{Known type?}
  B -- yes --> C[Module view]
  B -- no --> D[Text or hex]
  C --> E((Done))
""")
w("diagrams/notes.md", b"""# Diagrams in notes

```mermaid
sequenceDiagram
  Alice->>Bob: Hello
  Bob-->>Alice: Hi
```

Between the diagrams.

```dot
graph { a -- b -- c; a -- c }
```

```mermaid
flowchart TD
  A --> 
```
""")

# ---- drawings (M29) ----
import json as _json, zlib as _zlib, base64 as _b64, urllib.parse as _up
_eb = {"angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "hachure", "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None, "seed": 11, "version": 5, "versionNonce": 99, "isDeleted": False, "boundElements": None, "updated": 1792400000000, "link": None, "locked": False}
_els = [
    dict(_eb, id="box", type="rectangle", x=100, y=100, width=220, height=110, roundness={"type": 3}, backgroundColor="#a5d8ff", boundElements=[{"type": "text", "id": "label"}, {"type": "arrow", "id": "arr"}], index="a0"),
    dict(_eb, id="label", type="text", x=160, y=142.5, width=100, height=25, text="Hello", originalText="Hello", fontSize=20, fontFamily=5, textAlign="center", verticalAlign="middle", containerId="box", lineHeight=1.25, index="a1"),
    dict(_eb, id="circ", type="ellipse", x=520, y=100, width=120, height=110, backgroundColor="#b2f2bb", fillStyle="cross-hatch", boundElements=[{"type": "arrow", "id": "arr"}], index="a2"),
    dict(_eb, id="arr", type="arrow", x=324, y=155, width=192, height=0, points=[[0, 0], [192, 0]], startBinding={"elementId": "box", "focus": 0, "gap": 4}, endBinding={"elementId": "circ", "focus": 0, "gap": 4}, startArrowhead=None, endArrowhead="arrow", roundness={"type": 2}, lastCommittedPoint=None, index="a3"),
    dict(_eb, id="pen", type="freedraw", x=120, y=300, width=200, height=40, points=[[0, 0], [40, 30], [80, 5], [120, 40], [160, 10], [200, 30]], pressures=[], simulatePressure=True, strokeColor="#e03131", lastCommittedPoint=None, index="a4"),
    dict(_eb, id="note", type="text", x=420, y=300, width=200, height=50, text="Hand-drawn\nnotes", originalText="Hand-drawn\nnotes", fontSize=20, fontFamily=1, textAlign="left", verticalAlign="top", containerId=None, lineHeight=1.25, index="a5"),
]
w("drawings/sketch.excalidraw", _json.dumps({"type": "excalidraw", "version": 2, "source": "https://excalidraw.com", "elements": _els, "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None}, "files": {}}, indent=2).encode())
_page1 = """<mxGraphModel dx="1000" dy="600" grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="start" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="60" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="check" value="Valid?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="240" y="50" width="100" height="80" as="geometry"/></mxCell>
<mxCell id="done" value="Done" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="420" y="60" width="100" height="60" as="geometry"/></mxCell>
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="start" target="check"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e2" value="yes" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="check" target="done"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>"""
_page2 = """<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n" value="Second page" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="30" as="geometry"/></mxCell></root></mxGraphModel>"""
def _deflate(x):
    c = _zlib.compressobj(9, _zlib.DEFLATED, -15)
    return _b64.b64encode(c.compress(_up.quote(x, safe="~()*!.'").encode()) + c.flush()).decode()
w("drawings/flow.drawio", ('<mxfile host="app.diagrams.net" version="24.0.0"><diagram id="p1" name="Flow">' + _deflate(_page1) + '</diagram><diagram id="p2" name="Notes">' + _deflate(_page2) + '</diagram></mxfile>').encode())
# M45: a drawing with a photo (stays as it is on the dark canvas) and a draw.io file already on a dark background.
_photo = "data:image/png;base64," + _b64.b64encode(png(4, 4, (230, 60, 40))).decode()
w("drawings/photo.excalidraw", _json.dumps({"type": "excalidraw", "version": 2, "source": "https://excalidraw.com", "elements": [
    dict(_eb, id="pic", type="image", x=40, y=40, width=160, height=120, fileId="f1", status="saved", scale=[1, 1], index="a0"),
    dict(_eb, id="cap", type="text", x=40, y=180, width=160, height=25, text="Photo", originalText="Photo", fontSize=20, fontFamily=5, textAlign="left", verticalAlign="top", containerId=None, lineHeight=1.25, index="a1"),
], "appState": {"viewBackgroundColor": "#ffffff"}, "files": {"f1": {"mimeType": "image/png", "id": "f1", "dataURL": _photo, "created": 1792400000000}}}, indent=2).encode())
w("drawings/night.drawio", b"""<mxfile host="app.diagrams.net"><diagram id="n1" name="Night"><mxGraphModel background="#1e1e2e"><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Already dark" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#313244;strokeColor=#cdd6f4;fontColor=#cdd6f4;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="160" height="60" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>""")

# ---- packages and disk images (M26) ----
# deb/rpm/iso/msi samples were made with dpkg-deb, rpmbuild, xorriso and wixl
# (see internal/archive/testdata); jar/apk are zip files under another name.
for _n in ("mf-test.deb", "mf-test.rpm", "mf-test.iso", "mf-test.msi"):
    w("packages/" + _n, open(os.path.join(here, "..", "internal", "archive", "testdata", _n), "rb").read())
with zipfile.ZipFile(os.path.join(d, "packages", "app.jar"), "w") as z:
    zadd(z, "META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\nMain-Class: test.Main\n")
    zadd(z, "test/Main.class", b"\xca\xfe\xba\xbe\x00\x00\x00\x34")
with zipfile.ZipFile(os.path.join(d, "packages", "app.apk"), "w") as z:
    zadd(z, "AndroidManifest.xml", b"\x03\x00\x08\x00")
    zadd(z, "res/values/strings.txt", b"hello from apk\n")

_pos, _nor, _uv, _idx = _cube()
def _stl(scale=(20, 20, 20)):
    tris = [(_idx[i], _idx[i + 1], _idx[i + 2]) for i in range(0, len(_idx), 3)]
    out = bytearray(b"monoform fixture".ljust(80, b" ")) + struct.pack("<I", len(tris))
    for a, b, c in tris:
        out += struct.pack("<3f", *_nor[a])
        for v in (a, b, c): out += struct.pack("<3f", *[x * k for x, k in zip(_pos[v], scale)])
        out += b"\0\0"
    return bytes(out)
w("models/cube.stl", _stl())
# Tall along Z, the "up" of STL files from CAD and 3D printing: it should stand.
w("models/tower.stl", _stl((10, 10, 40)))
obj = ["mtllib textured.mtl", "o Box", "usemtl Checker"] + ["v %g %g %g" % tuple(p) for p in _pos] + ["vt %g %g" % (u, 1 - v) for u, v in _uv] + ["vn %g %g %g" % tuple(n) for n in _nor]
obj += ["f %d/%d/%d %d/%d/%d %d/%d/%d" % tuple(x for v in _idx[i:i + 3] for x in (v + 1, v + 1, v + 1)) for i in range(0, len(_idx), 3)]
w("models/textured.obj", ("\n".join(obj) + "\n").encode())
w("models/textured.mtl", b"newmtl Checker\nKd 1 1 1\nmap_Kd tex/checker.png\n")
w("models/tex/checker.png", png_fn(64, 64, lambda x, y: (40, 120, 220) if (x // 8 + y // 8) % 2 == 0 else (255, 255, 255)))
ply = ["ply", "format ascii 1.0", "element vertex 1000", "property float x", "property float y", "property float z", "property uchar red", "property uchar green", "property uchar blue", "end_header"]
for i in range(1000):
    t = i / 1000 * 20 * _math.pi
    ply.append("%f %f %f %d %d %d" % (_math.cos(t) * (1 + i / 1000), i / 500, _math.sin(t) * (1 + i / 1000), 255 * i // 1000, 120, 255 - 255 * i // 1000))
w("models/spiral.ply", ("\n".join(ply) + "\n").encode())
w("models/triangle.dae", b"""<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><up_axis>Y_UP</up_axis></asset>
  <library_geometries><geometry id="tri" name="Triangle"><mesh>
    <source id="tri-pos"><float_array id="tri-pos-a" count="9">0 0 0 1 0 0 0 1 0</float_array>
      <technique_common><accessor source="#tri-pos-a" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="tri-v"><input semantic="POSITION" source="#tri-pos"/></vertices>
    <triangles count="1"><input semantic="VERTEX" source="#tri-v" offset="0"/><p>0 1 2</p></triangles>
  </mesh></geometry></library_geometries>
  <library_visual_scenes><visual_scene id="s"><node id="n" name="Triangle"><instance_geometry url="#tri"/></node></visual_scene></library_visual_scenes>
  <scene><instance_visual_scene url="#s"/></scene>
</COLLADA>
""")

# ASCII FBX 7.4: a cube with two animation stacks ("Wave", "Nod").
def _fbx():
    verts = [-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]
    quads = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(2,3,7,6),(1,2,6,5),(0,4,7,3)]
    normals = [(0,0,-1),(0,0,1),(0,-1,0),(0,1,0),(1,0,0),(-1,0,0)]
    pvi = []
    for q in quads: pvi += [q[0], q[1], q[2], -q[3] - 1]
    nrm = []
    for n in normals: nrm += list(n) * 4
    sec = 46186158000
    def stack(sid, name, node, axis, values):
        times = ",".join(str(int(sec * i / (len(values) - 1) * 2)) for i in range(len(values)))
        vals = ",".join(str(v) for v in values)
        return f"""	AnimationStack: {sid}, "AnimStack::{name}", "" {{
		Properties70:  {{
			P: "LocalStop", "KTime", "Time", "",{sec * 2}
			P: "ReferenceStop", "KTime", "Time", "",{sec * 2}
		}}
	}}
	AnimationLayer: {sid + 1}, "AnimLayer::BaseLayer", "" {{
	}}
	AnimationCurveNode: {sid + 2}, "AnimCurveNode::R", "" {{
		Properties70:  {{
			P: "d|X", "Number", "", "A",0
			P: "d|Y", "Number", "", "A",0
			P: "d|Z", "Number", "", "A",0
		}}
	}}
	AnimationCurve: {sid + 3}, "AnimCurve::", "" {{
		Default: 0
		KeyVer: 4009
		KeyTime: *{len(values)} {{
			a: {times}
		}}
		KeyValueFloat: *{len(values)} {{
			a: {vals}
		}}
		KeyAttrFlags: *1 {{
			a: 24836
		}}
		KeyAttrDataFloat: *4 {{
			a: 0,0,218434821,0
		}}
		KeyAttrRefCount: *1 {{
			a: {len(values)}
		}}
	}}
""", f"""	C: "OO",{sid + 1},{sid}
	C: "OO",{sid + 2},{sid + 1}
	C: "OP",{sid + 2},{node}, "Lcl Rotation"
	C: "OP",{sid + 3},{sid + 2}, "d|{axis}"
"""
    s1, c1 = stack(4000, "Wave", 2000, "Y", [0, 90, 180, 270, 360])
    s2, c2 = stack(5000, "Nod", 2000, "X", [0, 30, 0])
    j = lambda a: ",".join(str(x) for x in a)
    return f"""; FBX 7.4.0 project file
FBXHeaderExtension:  {{
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}}
GlobalSettings:  {{
	Version: 1000
	Properties70:  {{
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
	}}
}}
Objects:  {{
	Geometry: 1000, "Geometry::Cube", "Mesh" {{
		Vertices: *{len(verts)} {{
			a: {j(verts)}
		}}
		PolygonVertexIndex: *{len(pvi)} {{
			a: {j(pvi)}
		}}
		GeometryVersion: 124
		LayerElementNormal: 0 {{
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			Normals: *{len(nrm)} {{
				a: {j(nrm)}
			}}
		}}
		Layer: 0 {{
			Version: 100
			LayerElement:  {{
				Type: "LayerElementNormal"
				TypedIndex: 0
			}}
		}}
	}}
	Model: 2000, "Model::Cube", "Mesh" {{
		Version: 232
		Properties70:  {{
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
		}}
		Shading: T
		Culling: "CullingOff"
	}}
	Material: 3000, "Material::Red", "" {{
		Version: 102
		ShadingModel: "phong"
		MultiLayer: 0
		Properties70:  {{
			P: "DiffuseColor", "Color", "", "A",0.8,0.25,0.2
		}}
	}}
{s1}{s2}}}
Connections:  {{
	C: "OO",2000,0
	C: "OO",1000,2000
	C: "OO",3000,2000
{c1}{c2}}}
""".encode()
w("models/waving.fbx", _fbx())

# 50 MB+ log file
big = os.path.join(d, "big.log")
if not os.path.exists(big):
    with open(big, "wb") as f:
        line = 0
        while f.tell() < 52 * 1024 * 1024:
            chunk = "".join(f"2026-10-19T12:00:{line % 60:02}Z INFO [worker-{line % 8}] request {line} handled in {line % 997} ms path=/api/v1/items/{line}\n" for line in range(line, line + 10000))
            f.write(chunk.encode())
            line += 10000
print(d)
