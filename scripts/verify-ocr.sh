#!/usr/bin/env bash
# Check the PDF the m30 self-test made searchable with another tool:
# pdftotext (poppler) must find the recognised text on both pages.
set -euo pipefail
F=$1/ocr/scanned.pdf
fail() { echo "FAIL: $*"; exit 1; }
[ -f "$F" ] || fail "missing $F (run the m30 self-test first)"
T=$(pdftotext "$F" - | tr -s ' \n' ' ')
for want in "reads text" "Invoice 2026-0417" "quick brown fox" "Second page of the scan" "Searchable after OCR"; do
  grep -q "$want" <<<"$T" || fail "\"$want\" not found in the text layer: $T"
done
P2=$(pdftotext -f 2 -l 2 "$F" - | tr -s ' \n' ' ')
grep -q "Searchable after OCR" <<<"$P2" || fail "page 2 text is on the wrong page"
echo "PASS verify-ocr"
