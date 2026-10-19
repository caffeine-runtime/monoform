#!/usr/bin/env bash
# Run an in-webview self-test scenario against the built Linux binary.
#   scripts/selftest.sh <scenario> [arg] [settings.json]
# Needs Xvfb + a window manager (openbox) when no display is available.
# Exit code 0 = PASS.
set -euo pipefail
cd "$(dirname "$0")/.."
SCENARIO=$1
ARG=${2:-}
SETTINGS=${3:-$(mktemp -d)/settings.json}
BIN=${HIA_BIN:-build/bin/hold-it-all}
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:99
  pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 1; }
  pgrep openbox >/dev/null || { openbox >/dev/null 2>&1 & sleep 0.5; }
fi
LOG=$(mktemp)
set +e
HIA_TEST="$SCENARIO" HIA_TEST_ARG="$ARG" HIA_SETTINGS="$SETTINGS" timeout "${HIA_TIMEOUT:-120}" "$BIN" >"$LOG" 2>&1
CODE=$?
set -e
grep -E "selftest|startup:" "$LOG" || true
if [ $CODE -ne 0 ]; then
  echo "--- full log ---"; tail -40 "$LOG"
fi
exit $CODE
