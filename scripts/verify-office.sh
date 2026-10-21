#!/usr/bin/env bash
# Open the documents written by the m4b self-test in LibreOffice (another
# office suite) and check their content.
set -euo pipefail
D=$1/office
OUT=$(mktemp -d)
fail() { echo "FAIL: $*"; exit 1; }
export HOME=${HOME_FOR_SOFFICE:-$OUT}
soffice --headless --convert-to txt:Text --outdir "$OUT" "$D/report.docx" "$D/legacy.docx" >/dev/null 2>&1
soffice --headless --convert-to csv --outdir "$OUT" "$D/budget.xlsx" >/dev/null 2>&1
mv "$OUT/budget.csv" "$OUT/budget-sheet1.csv"
soffice --headless --convert-to csv --outdir "$OUT" "$D/legacy.xlsx" >/dev/null 2>&1
grep -q "Last paragraph, edited in Monoform." "$OUT/report.txt" || fail "docx edit not readable by LibreOffice"
grep -q "A brand new paragraph." "$OUT/report.txt" || fail "new paragraph missing"
grep -q "Quarterly report" "$OUT/report.txt" || fail "heading lost"
grep -q "Converted: Quarterly report" "$OUT/legacy.txt" || fail "converted .doc text"
python3 - "$D/report.docx" <<'PY' || fail "docx structure"
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
doc = z.read("word/document.xml").decode()
assert re.search(r"<w:b/>.*?<w:t[^>]*>edited</w:t>", doc, re.S), "bold run missing"
assert "Heading" in doc or "pStyle" in doc, "heading style lost"
print("parts:", len(z.namelist()))
PY
cat "$OUT/budget-sheet1.csv"
grep -q "Rent,1300" "$OUT/budget-sheet1.csv" || fail "edited cell"
grep -q "Total,1312.5" "$OUT/budget-sheet1.csv" || fail "SUM not recalculated by LibreOffice"
grep -q "Note,656.25" "$OUT/budget-sheet1.csv" || fail "new formula"
grep -q "Café ☕,99" "$OUT/legacy.csv" || fail "converted xls"
echo "PASS verify-office"
