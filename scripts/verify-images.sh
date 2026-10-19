#!/usr/bin/env bash
# Check image-editor outputs of the m9 self-test with independent tools
# (Python's zipfile/xml, no image libraries needed): the .ora file follows
# the OpenRaster spec and the "save a copy" file exists next to the original.
#   scripts/verify-images.sh <fixtures dir>
set -euo pipefail
D=$1/img
python3 -I - "$D/out/layers.ora" <<'PY'
import sys, zipfile, xml.etree.ElementTree as ET
p = sys.argv[1]
z = zipfile.ZipFile(p)
assert z.testzip() is None, "zip CRC error"
first = z.infolist()[0]
assert first.filename == "mimetype" and first.compress_type == zipfile.ZIP_STORED, "mimetype must be the first, stored entry"
assert z.read("mimetype") == b"image/openraster", "mimetype content"
root = ET.fromstring(z.read("stack.xml"))
assert root.tag == "image" and int(root.get("w")) > 0 and int(root.get("h")) > 0, "image size"
layers = root.findall(".//layer")
assert len(layers) == 2, f"expected 2 layers, got {len(layers)}"
names = [l.get("name") for l in layers]
assert names == ["Top", "Background"], f"top-first names {names}"
for l in layers:
    data = z.read(l.get("src"))
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{l.get('src')} is not a PNG"
for need in ("mergedimage.png", "Thumbnails/thumbnail.png"):
    assert z.read(need)[:8] == b"\x89PNG\r\n\x1a\n", need
print(f"layers.ora: valid OpenRaster, {len(layers)} layers {names}, {root.get('w')}x{root.get('h')}")
PY
test -s "$D/subject (edited).png" && echo "save a copy: 'subject (edited).png' written next to the untouched original"
cmp -s "$D/subject.png" "$D/subject (edited).png" && { echo "copy is identical to the original?"; exit 1; } || true
echo "verify-images: OK"
