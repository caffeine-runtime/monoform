#!/usr/bin/env bash
# Check the ZIP created by the m5 self-test with the OS's own tools.
set -euo pipefail
Z=$1/archives/out/created.zip
fail() { echo "FAIL: $*"; exit 1; }
if command -v unzip >/dev/null; then unzip -t "$Z" | tail -1; unzip -t "$Z" >/dev/null || fail "unzip -t"; fi
if command -v 7z >/dev/null; then 7z t "$Z" | grep -q "Everything is Ok" || fail "7z t"; echo "7z: Everything is Ok"; fi
if command -v bsdtar >/dev/null; then bsdtar -tf "$Z" >/dev/null || fail "bsdtar"; fi
python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read('docs/readme.md').startswith(b'# Inside'); print('python zipfile: ok')" "$Z"
[ ! -e "$1/escaped.txt" ] && [ ! -e "$1/archives/escaped.txt" ] && [ ! -e "$1/archives/out/escaped.txt" ] || fail "zip slip escaped"
echo "PASS verify-archives"
