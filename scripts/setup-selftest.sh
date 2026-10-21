#!/usr/bin/env bash
# The setup program's demo on Linux (cmd/setup): it installs into a test
# folder through its own window, which clicks through by itself
# (HIA_SETUP_TEST), then uninstalls; the folder and the recorded registry,
# shortcuts and command shim are checked. Needs X (selftest.sh-style Xvfb).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
(cd frontend && npm run --silent build:setup >/dev/null)
go build -tags desktop,production,webkit2_41 -o "$OUT/setup" ./cmd/setup
if [ -z "${DISPLAY:-}" ]; then
  Xvfb :97 -screen 0 1280x800x24 >/dev/null 2>&1 &
  XVFB=$!
  trap 'kill $XVFB 2>/dev/null || true' EXIT
  export DISPLAY=:97
  sleep 1
fi
export HIA_SETUP_DEMO_DIR="$OUT/demo" HIA_SETUP_TEST=1
DIR="$HIA_SETUP_DEMO_DIR/Users/you/AppData/Local/Programs/Hold It All"
timeout 60 "$OUT/setup" 2>&1 | grep -E "SETUP (PASS|FAIL)" | tee "$OUT/log"
grep -q "SETUP PASS install" "$OUT/log"
for f in hold-it-all.exe holdit.exe fileicon.ico uninstall.exe; do test -f "$DIR/$f" || { echo "FAIL setup: $f not installed"; exit 1; }; done
python3 - "$HIA_SETUP_DEMO_DIR/registry.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
r = d["registry"]
assert r[r"HKCU\microsoft\windows\currentversion\uninstall\holditall"]["DisplayName"] == "Hold It All", "uninstall entry"
assert r[r"HKCU\classes\*\shell\holditall.peek\command"][""].endswith('--peek "%1"'), "quick peek verb"
assert d["shortcuts"].get(r"HKCU Programs\Hold It All"), "start menu shortcut"
assert d["shims"].get("holdit.cmd"), "holdit command"
print("setup: installed files, uninstall entry, quick peek, shortcut and command")
PY
timeout 60 "$OUT/setup" --uninstall 2>&1 | grep -E "SETUP (PASS|FAIL)" | tee "$OUT/log"
grep -q "SETUP PASS uninstall" "$OUT/log"
test ! -e "$DIR" || { echo "FAIL setup: folder left after uninstall"; exit 1; }
python3 - "$HIA_SETUP_DEMO_DIR/registry.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
left = [k for k, v in d["registry"].items() if v]
assert not left and not d["shortcuts"] and not d["shims"], f"left behind: {left} {d['shortcuts']} {d['shims']}"
print("setup: uninstall left nothing behind")
PY
echo "PASS setup"
