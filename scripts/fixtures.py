#!/usr/bin/env python3
"""Create self-test fixtures: scripts/fixtures.py <dir>"""
import os, sys, struct, zlib, shutil

d = sys.argv[1]
# Outputs written by earlier self-test runs; operations refuse to overwrite.
for rel in ("pdf/out", "archives/out"):
    shutil.rmtree(os.path.join(d, rel), ignore_errors=True)
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
w("img/photo.png", png_fn(400, 300, lambda x, y: (0, 0, 0) if x < 200 and (x // 2) % 2 == 0 else ((255, 255, 255) if x < 200 else (40, 80, 200))))
w("img/vector.svg", b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="12" fill="#d97757"/><circle cx="60" cy="40" r="22" fill="#fff"/></svg>')
# A 2-frame GIF (built by hand: 2x2 pixels, global palette of 2 colours).
gif = (b"GIF89a\x02\x00\x02\x00\x80\x00\x00" + bytes([255, 0, 0, 0, 0, 255]) +
       b"!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00" +
       b"!\xf9\x04\x00\x0a\x00\x00\x00" + b",\x00\x00\x00\x00\x02\x00\x02\x00\x00\x02\x02\x84\x51\x00" +
       b"!\xf9\x04\x00\x0a\x00\x00\x00" + b",\x00\x00\x00\x00\x02\x00\x02\x00\x00\x02\x02\x0c\x0a\x00" + b";")
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
# Form: one text field and one checkbox on page 1 (objects 6 and 7 for a 1-page doc).
form_objs = [
    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [72 600 372 624] /F 4 /DA (/Helv 12 Tf 0 g) /MK << /BC [0 0 0] >> /P 4 0 R >>",
    "<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /Rect [72 560 90 578] /F 4 /V /Off /AS /Off /MK << /BC [0 0 0] >> /P 4 0 R /AP << /N << /Yes 8 0 R /Off 9 0 R >> >> >>",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 18 18] /Length 30 >>\nstream\n0 0 m 18 18 l 18 0 m 0 18 l S\nendstream",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 18 18] /Length 0 >>\nstream\n\nendstream",
]
w("pdf/form.pdf", pdf(1, form_objs, "/AcroForm << /Fields [6 0 R 7 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >> >>", lambda i: "/Annots [6 0 R 7 0 R]"))

# Data
w("data/sample.json", b'{\n  "name": "Hold It All",\n  "version": 1,\n  "tags": ["fast", "calm"],\n  "nested": {"deep": {"list": [1, 2, {"x key": true}]}},\n  "nothing": null\n}\n')
w("data/invalid.json", b'{\n  "a": 1,\n  "b": [1, 2,\n  "c": "missing bracket"\n}\n')
w("data/sample.yaml", b"# config\nname: Hold It All\nports:\n  - 80\n  - 443\nowner:\n  name: Ann\n  active: true\n")
w("data/invalid.yaml", b"name: ok\nlist:\n  - a\n - b\n")
w("data/semi.csv", 'name;city;amount\r\n"Kowalski; Jan";Kraków;12,50\r\nAnn;"Paris\r\nFrance";7\r\nBob;Rome;100\r\n'.encode())
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
for src, dst in [("doc.docx", "report.docx"), ("doc.doc", "legacy.doc"), ("sheet.xlsx", "budget.xlsx"), ("sheet.xls", "legacy.xls")]:
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
