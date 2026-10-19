#!/usr/bin/env bash
# Regenerates internal/office/testdata with LibreOffice (dev-only; the results
# are committed so tests don't need LibreOffice).
set -euo pipefail
cd "$(dirname "$0")"
OUT=../../internal/office/testdata
mkdir -p "$OUT"
soffice --headless --convert-to xls --outdir "$OUT" sheet.fods >/dev/null
soffice --headless --convert-to xlsx --outdir "$OUT" sheet.fods >/dev/null
soffice --headless --convert-to 'doc:MS Word 97' --outdir "$OUT" doc.html >/dev/null
soffice --headless --convert-to 'docx:MS Word 2007 XML' --outdir "$OUT" doc.html >/dev/null
ls -la "$OUT"
