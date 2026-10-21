#!/usr/bin/env bash
# Records the README's clips (docs/readme/*.webp) and gallery screenshots
# (docs/screenshots/*.png) from the real app (Linux):
#   scripts/readme-media.sh [scene…]        (default: all; stills are still-<name>)
# Builds the demo folder (scripts/demo_files.py), runs each scene of the
# "demo" self-test on its own X display (1280×800, no window manager, so
# the window fills it) and records it with ffmpeg; the clips are animated
# WebP. Needs a built app (scripts/build.sh), Xvfb and ffmpeg with libwebp.
set -euo pipefail
cd "$(dirname "$0")/.."
SCENES=("$@")
STILLS=(start markdown pdf spreadsheet word svg html json model3d audio video archive checksums compare palette settings)
[ ${#SCENES[@]} -eq 0 ] && SCENES=(tour image markdown split "${STILLS[@]/#/still-}")
BIN=${MF_BIN:-build/bin/monoform}
OUT=docs/readme
WORK=$(mktemp -d)
trap 'kill $XPID 2>/dev/null || true; [ -n "${MF_KEEP:-}" ] && echo "kept $WORK" || rm -rf "$WORK"; rm -rf "$DIR"' EXIT
mkdir -p "$OUT"
# The folder shows in the path bar, so it lives somewhere tidy.
DEMO=${MF_DEMO_ROOT:-/tmp/Documents}
DIR=$(python3 scripts/demo_files.py "$DEMO")

export DISPLAY=:97
Xvfb :97 -screen 0 1280x800x24 -nocursor >/dev/null 2>&1 &
XPID=$!
sleep 1

# Theme per scene: light or dark.
declare -A THEME=([tour]=light [image]=dark [markdown]=light [split]=dark
  [still-pdf]=dark [still-model3d]=dark [still-audio]=dark [still-video]=dark [still-palette]=dark [still-json]=dark [still-archive]=dark)

waitlog() { # waitlog <file> <text> <seconds>
  for _ in $(seq $(($3 * 10))); do grep -q "$2" "$1" && return 0; sleep 0.1; done
  echo "timed out waiting for '$2'"; tail -20 "$1"; return 1
}

start() { # start <scene>: the app running the scene, logging to $LOG
  LOG="$WORK/$1.log"
  MF_TEST=demo MF_TEST_ARG="$1|$DIR|${THEME[$1]:-light}" MF_SETTINGS="$WORK/$1-settings.json" MF_CACHE="$WORK/cache" \
    timeout 180 "$BIN" >"$LOG" 2>&1 &
  APP=$!
}

for s in "${SCENES[@]}"; do
  if [[ $s == still-* ]]; then
    PNG="docs/screenshots/${s#still-}.png"
    # WebKitGTK on a bare X server now and then shows a window it never
    # painted (just the background colour): run the scene again.
    for _ in 1 2 3 4 5; do
      start "$s"
      waitlog "$LOG" "demo: still" 90
      ffmpeg -loglevel error -y -f x11grab -draw_mouse 0 -video_size 1280x800 -i :97 -frames:v 1 "$PNG"
      wait $APP || true
      [ "$(stat -c %s "$PNG")" -gt 30000 ] && break
      echo "$s: blank, again"
    done
    echo "$s: $(du -h "$PNG" | cut -f1)"
    continue
  fi
  start "$s"
  waitlog "$LOG" "demo: rec" 60
  ffmpeg -loglevel error -y -f x11grab -draw_mouse 0 -framerate 30 -video_size 1280x800 -i :97 -c:v libx264rgb -crf 0 -preset ultrafast "$WORK/$s.mkv" &
  REC=$!
  waitlog "$LOG" "demo: end" 150
  sleep 0.2
  kill -INT $REC; wait $REC || true
  wait $APP || true
  # Drop the waits the scene marked, then 20 fps at 1000 px wide.
  CUTS=$(grep -o 'cuts=[0-9.,-]*' "$LOG" | cut -d= -f2)
  SEL=""
  if [ -n "$CUTS" ]; then
    EXPR=$(echo "$CUTS" | tr ',' '\n' | awk -F- '{printf "%sbetween(t,%s,%s)", (NR>1?"+":""), $1, $2}')
    SEL="select='not($EXPR)',setpts=N/30/TB,"
  fi
  ffmpeg -loglevel error -y -i "$WORK/$s.mkv" -vf "${SEL}fps=20,scale=1000:-1:flags=lanczos" \
    -c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 "$OUT/$s.webp"
  echo "$s: $(du -h "$OUT/$s.webp" | cut -f1)"
done
