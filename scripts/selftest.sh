#!/usr/bin/env bash
# Run an in-webview self-test scenario against the built Linux binary.
#   scripts/selftest.sh <scenario> [arg] [settings.json] [app arguments…]
# Needs Xvfb + a window manager (openbox) when no display is available.
# Exit code 0 = PASS.
set -euo pipefail
# The interface in English unless a test asks otherwise (labels are looked up by their English text).
export MF_SYSTEM_LANG=${MF_SYSTEM_LANG:-en}
cd "$(dirname "$0")/.."
SCENARIO=$1
ARG=${2:-}
SETTINGS=${3:-$(mktemp -d)/settings.json}
shift $(( $# < 3 ? $# : 3 ))
BIN=${MF_BIN:-build/bin/monoform}
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:99
  pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 1; }
  pgrep openbox >/dev/null || { openbox >/dev/null 2>&1 & sleep 0.5; }
  # A bare X server has no desktop to answer the screenshot portal.
  export MF_NO_PORTAL=${MF_NO_PORTAL:-1}
fi
LOG=$(mktemp)
set +e
MF_SCREENSHOTS="${MF_SCREENSHOTS:-${TMPDIR:-/tmp}/mf-screenshots}" MF_TEST="$SCENARIO" MF_TEST_ARG="$ARG" MF_SETTINGS="$SETTINGS" timeout -k 10 "${MF_TIMEOUT:-120}" "$BIN" "$@" >"$LOG" 2>&1
CODE=$?
set -e
grep -E "selftest|startup:" "$LOG" || true
if [ $CODE -ne 0 ]; then
  echo "--- full log ---"; tail -40 "$LOG"
fi
exit $CODE
