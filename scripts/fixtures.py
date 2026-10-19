#!/usr/bin/env python3
"""Create self-test fixtures: scripts/fixtures.py <dir>"""
import os, sys, struct, zlib

d = sys.argv[1]
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
