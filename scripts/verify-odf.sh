#!/usr/bin/env bash
# Open the OpenDocument files written by the m27 self-test in LibreOffice and
# check their content (dev-only; needs soffice).
set -euo pipefail
D=$1/office
OUT=$(mktemp -d)
fail() { echo "FAIL: $*"; exit 1; }
export HOME=${HOME_FOR_SOFFICE:-$OUT}
soffice --headless --convert-to "txt:Text (encoded):UTF8" --outdir "$OUT" "$D/notes.odt" >/dev/null 2>&1
soffice --headless --convert-to csv --outdir "$OUT" "$D/budget.ods" >/dev/null 2>&1
cat "$OUT/notes.txt"
grep -q "Last paragraph, edited in Hold It All." "$OUT/notes.txt" || fail "odt edit not readable by LibreOffice"
grep -q "Step three" "$OUT/notes.txt" || fail "new list item missing"
grep -q "Quarterly report" "$OUT/notes.txt" || fail "heading lost"
unzip -p "$D/notes.odt" content.xml | grep -q "<text:note-body><text:p[^>]*>A footnote.</text:p>" || fail "footnote lost"
grep -q "Inside a section." "$OUT/notes.txt" || fail "section lost"
cat "$OUT/budget.csv"
grep -q "^Rent,1300" "$OUT/budget.csv" || fail "edited cell"
grep -q "^Total,1312.5" "$OUT/budget.csv" || fail "total"
echo "PASS verify-odf"
