#!/usr/bin/env bash
# Take a screenshot of the app in a given state (Linux/Xvfb):
#   scripts/screenshot.sh out.png "<folder>|<file,file>|<command,ids>|<search query>" [settings.json]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$1; ARG=$2; SETTINGS=${3:-$(mktemp -d)/settings.json}
export DISPLAY=${DISPLAY:-:99}
pgrep -f "Xvfb $DISPLAY" >/dev/null || { Xvfb "$DISPLAY" -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 1; }
pgrep openbox >/dev/null || { openbox >/dev/null 2>&1 & sleep 0.5; }
HIA_TEST=show HIA_TEST_ARG="$ARG" HIA_SETTINGS="$SETTINGS" timeout 30 "${HIA_BIN:-build/bin/hold-it-all}" >/dev/null 2>&1 &
PID=$!
sleep "${SHOT_DELAY:-3.5}"
WID=$(xdotool search --name "Hold It All" | tail -1)
import -window "$WID" "$OUT"
wait $PID || true
