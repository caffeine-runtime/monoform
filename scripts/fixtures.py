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
