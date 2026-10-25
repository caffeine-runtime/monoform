#!/usr/bin/env bash
# Records the README's clips (docs/readme/*.webp) and gallery screenshots
# (docs/screenshots/*.png) from the real app (Linux):
#   scripts/readme-media.sh [scene…]        (default: all; stills are still-<name>)
# Builds the demo folder (scripts/demo_files.py), runs each scene of the
# "demo" self-test on its own X display (1280×800, no window manager, so
# the window fills it) and records it with ffmpeg; the clips are animated
# WebP. Needs a built app (scripts/build.sh), Xvfb and ffmpeg with libwebp.
# "promo" records the 1080p promo video instead (H.264 MP4 with the demo
# folder's Goldberg recording, CC0, faded in and out) to $MF_PROMO_OUT
# (default build/bin/monoform-promo.mp4; not committed: upload it where needed)
# and an animated WebP of it for the README (docs/readme/promo.webp).
# The tour and the promo use the optional subject model (Better subject selection): it is
# downloaded once (~200 MB, with the ONNX Runtime library) into
# $MF_DEMO_MODELS (default ~/.cache/monoform-demo/app) and kept there.
set -euo pipefail
# The interface in English unless a test asks otherwise (labels are looked up by their English text).
export MF_SYSTEM_LANG=${MF_SYSTEM_LANG:-en}
cd "$(dirname "$0")/.."
SCENES=("$@")
STILLS=(pdf word spreadsheet compare svg model3d audio video json html archive settings)
# MF_STILL_SIZE / MF_STILL_DIR: stills at another size, somewhere else (the Store listing:
# MF_STILL_SIZE=1920x1080 MF_STILL_DIR=… scripts/readme-media.sh still-ai still-split …).
STILL_SIZE=${MF_STILL_SIZE:-}
STILL_DIR=${MF_STILL_DIR:-docs/screenshots}
[ ${#SCENES[@]} -eq 0 ] && SCENES=(tour image markdown split "${STILLS[@]/#/still-}")
BIN=${MF_BIN:-build/bin/monoform}
OUT=docs/readme
WORK=$(mktemp -d)
trap 'kill ${XPID:-} 2>/dev/null || true; [ -n "${MF_KEEP:-}" ] && echo "kept $WORK" || rm -rf "$WORK"; rm -rf "$DIR"' EXIT
mkdir -p "$OUT"
# The folder shows in the path bar, so it lives somewhere tidy.
DEMO=${MF_DEMO_ROOT:-/tmp/Documents}
DIR=$(python3 scripts/demo_files.py "$DEMO")

export DISPLAY=:97
# Big enough for the promo; the other scenes' 1280×800 window sits in its corner.
Xvfb :97 -screen 0 1920x1080x24 -nocursor >/dev/null 2>&1 &
XPID=$!
sleep 1

# Theme per scene: light or dark.
declare -A THEME=([tour]=dark [promo]=dark [footage]=dark [image]=dark [markdown]=light [split]=dark
  [still-pdf]=dark [still-model3d]=dark [still-audio]=dark [still-video]=dark [still-json]=dark [still-archive]=dark
  [still-ai]=dark [still-split]=dark)

waitlog() { # waitlog <file> <text> <seconds>
  for _ in $(seq $(($3 * 10))); do grep -q "$2" "$1" && return 0; sleep 0.1; done
  echo "timed out waiting for '$2'"; tail -20 "$1"; return 1
}

MODELS=${MF_DEMO_MODELS:-${XDG_CACHE_HOME:-$HOME/.cache}/monoform-demo/app}
start() { # start <scene> [seconds]: the app running the scene, logging to $LOG
  LOG="$WORK/$1.log"
  local cache="$WORK/cache"
  [[ $1 == tour || $1 == promo || $1 == footage || $1 == models || $1 == still-ai ]] && cache=$MODELS
  local size=""
  [[ $1 == still-* ]] && size=$STILL_SIZE
  MF_TEST=demo MF_TEST_ARG="$1|$DIR|${THEME[$1]:-light}|$size" MF_SETTINGS="$WORK/$1-settings.json" MF_CACHE="$cache" \
    timeout "${2:-180}" "$BIN" >"$LOG" 2>&1 &
  APP=$!
}

if [[ " ${SCENES[*]} " =~ " "(tour|promo|footage|still-ai)" " ]]; then
  mkdir -p "$MODELS"
  start models 1800
  waitlog "$LOG" "demo: models ready" 1800
  wait $APP || true
fi

for s in "${SCENES[@]}"; do
  if [[ $s == still-* ]]; then
    PNG="$STILL_DIR/${s#still-}.png"
    SHOT=${STILL_SIZE:-1280x800}
    mkdir -p "$STILL_DIR"
    # WebKitGTK on a bare X server now and then shows a window it never
    # painted (just the background colour): run the scene again.
    for _ in 1 2 3 4 5; do
      start "$s"
      waitlog "$LOG" "demo: still" 90
      ffmpeg -loglevel error -y -f x11grab -draw_mouse 0 -video_size $SHOT -i :97 -frames:v 1 "$PNG"
      wait $APP || true
      [ "$(stat -c %s "$PNG")" -gt 30000 ] && break
      echo "$s: blank, again"
    done
    echo "$s: $(du -h "$PNG" | cut -f1)"
    continue
  fi
  SIZE=1280x800
  [[ $s == promo || $s == footage ]] && SIZE=1920x1080
  start "$s" 240
  waitlog "$LOG" "demo: rec" 60
  ffmpeg -loglevel error -y -f x11grab -draw_mouse 0 -framerate 30 -video_size $SIZE -i :97 -c:v libx264rgb -crf 0 -preset ultrafast "$WORK/$s.mkv" &
  REC=$!
  waitlog "$LOG" "demo: end" 230
  sleep 0.2
  kill -INT $REC; wait $REC || true
  wait $APP || true
  # Drop the waits the scene marked and speed its slow-motion stretches back up
  # (scripts/demo_timeline.py), then encode.
  CUTS=$(grep -o 'cuts=[0-9.,-]*' "$LOG" | cut -d= -f2)
  SPEEDS=$(grep -o 'speeds=[0-9.,:-]*' "$LOG" | cut -d= -f2)
  MARKS=$(grep -o 'marks=[^ ]*' "$LOG" | cut -d= -f2)
  RAW=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/$s.mkv")
  python3 scripts/demo_timeline.py "$CUTS" "$SPEEDS" "$RAW" "$MARKS" > "$WORK/$s-timeline.json"
  FC=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["filter"])' "$WORK/$s-timeline.json")
  if [[ $s == footage ]]; then
    # The ad's shots (scripts/ad/make.py): the clean promo, edited, near-lossless, and its
    # section marks on the edited timeline.
    AD=${MF_AD_DIR:-build/bin/ad}
    mkdir -p "$AD"
    ffmpeg -loglevel error -y -i "$WORK/$s.mkv" -filter_complex "$FC;[cut]fps=30,format=yuv420p[o]" -map "[o]" -c:v libx264 -preset slow -crf 10 -an "$AD/footage.mp4"
    python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["marks"]))' "$WORK/$s-timeline.json" > "$AD/marks.json"
    echo "footage: $AD/footage.mp4, marks $(cat "$AD/marks.json")"
    continue
  fi
  if [[ $s == promo ]]; then
    PROMO=${MF_PROMO_OUT:-build/bin/monoform-promo.mp4}
    mkdir -p "$(dirname "$PROMO")"
    ffmpeg -loglevel error -y -i "$WORK/$s.mkv" -filter_complex "$FC;[cut]fps=30,format=yuv420p[o]" -map "[o]" -c:v libx264 -preset slow -crf 18 -an "$WORK/promo-video.mp4"
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/promo-video.mp4")
    ffmpeg -loglevel error -y -i "$WORK/promo-video.mp4" -i "$DIR/Goldberg Variation 1.ogg" -map 0:v -map 1:a -c:v copy \
      -af "volume=0.55,afade=t=in:d=1.2,afade=t=out:st=$(echo "$DUR - 2.5" | bc):d=2.5" -c:a aac -b:a 160k -shortest -movflags +faststart "$PROMO"
    echo "promo: $PROMO $(du -h "$PROMO" | cut -f1), ${DUR%.*} s"
    # The README's copy: an animated WebP (GitHub doesn't play videos from the repository).
    ffmpeg -loglevel error -y -i "$PROMO" -vf "fps=15,scale=1000:-1:flags=lanczos" -c:v libwebp_anim -lossless 0 -quality 75 \
      -compression_level 6 -loop 0 "$OUT/promo.webp"
    echo "promo: $OUT/promo.webp $(du -h "$OUT/promo.webp" | cut -f1)"
    continue
  fi
  ffmpeg -loglevel error -y -i "$WORK/$s.mkv" -filter_complex "$FC;[cut]fps=20,scale=1000:-1:flags=lanczos[o]" -map "[o]" \
    -c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 "$OUT/$s.webp"
  echo "$s: $(du -h "$OUT/$s.webp" | cut -f1)"
done
