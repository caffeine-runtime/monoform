#!/usr/bin/env bash
# Check the PDFs written by the m3 self-test with independent tools
# (qpdf for structure, poppler's pdftotext/pdfinfo as "another PDF reader").
set -euo pipefail
OUT=$1/pdf/out
fail() { echo "FAIL: $*"; exit 1; }
for f in "$OUT"/*.pdf "$OUT"/split/*.pdf; do
  qpdf --check "$f" >/dev/null 2>&1 || { qpdf --check "$f" | tail -3; fail "qpdf --check $f"; }
  pdftotext "$f" - >/dev/null 2>&1 || fail "pdftotext $f"
done
echo "structure: $(ls "$OUT"/*.pdf "$OUT"/split/*.pdf | wc -l) files pass qpdf --check and open in poppler"

annots=$(python3 - "$OUT/annotated.pdf" <<'PY'
import subprocess, sys, re
raw = subprocess.run(["qpdf", "--qdf", "--object-streams=disable", sys.argv[1], "-"], capture_output=True).stdout.decode("latin-1")
kinds = sorted(set(re.findall(r"/Subtype /(FreeText|Ink|Highlight)", raw)))
print(",".join(kinds))
PY
)
echo "annotations in annotated.pdf: $annots"
[[ "$annots" == *FreeText* && "$annots" == *Ink* && "$annots" == *Highlight* ]] || fail "missing annotations"
pdftotext "$OUT/annotated.pdf" - | grep -q "Page 1" || fail "annotated text lost"

form=$(qpdf --json --json-key=acroform "$OUT/filled.pdf" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(";".join("%s=%s" % (f["fullname"], f["value"]) for f in d["acroform"]["fields"]))')
echo "form fields: $form"
[[ "$form" == *"name=u:Alice Example"* || "$form" == *"name=Alice Example"* ]] || fail "text field value not saved"
[[ "$form" != *"agree=/Off"* ]] || fail "checkbox not saved"

order=$(pdftotext "$OUT/reordered.pdf" - | tr -d "\f" | grep -o "^Page [0-9]*" | tr '\n' ',')
echo "reordered page order: $order"
[ "$order" = "Page 3,Page 1,Page 2,Page 1," ] || fail "unexpected order"
pdfinfo -f 1 -l 1 "$OUT/reordered.pdf" | grep -Eq "rot: +90" || fail "page 1 not rotated"

ex=$(pdftotext "$OUT/extract.pdf" - | tr -d "\f" | grep -o "^Page [0-9]*" | tr '\n' ',')
[ "$ex" = "Page 2,Page 50,Page 99," ] || fail "extract order $ex"
total=0; for f in "$OUT"/split/*.pdf; do n=$(pdfinfo "$f" | awk '/^Pages:/{print $2}'); total=$((total+n)); done
[ "$total" = 100 ] || fail "split pages $total"
echo "PASS verify-pdf"
