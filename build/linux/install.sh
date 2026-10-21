#!/bin/sh
# Install Monoform for the current user (no root needed):
#   ./install.sh                 install; the app appears in "Open With" menus
#   ./install.sh --set-default   also make it the default app for its file types
#   ./install.sh --uninstall     remove it again
set -eu
cd "$(dirname "$0")"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor/512x512/apps"

refresh() {
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APPS" || true; fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t "$DATA/icons/hicolor" || true; fi
}

case "${1:-}" in
--uninstall)
  rm -f "$BIN/monoform" "$APPS/monoform.desktop" "$APPS/monoform-peek.desktop" "$ICONS/monoform.png"
  refresh
  echo "Removed. Settings stay in ~/.config/Monoform; the optional search model and indexes in ~/.cache/Monoform."
  exit 0
  ;;
--set-default | "") ;;
*)
  echo "usage: $0 [--set-default | --uninstall]" >&2
  exit 2
  ;;
esac

mkdir -p "$BIN" "$APPS" "$ICONS"
# One program: the app, and the monoform command (monoform hash, verify, info, convert).
install -m 755 monoform "$BIN/monoform"
install -m 644 monoform.png "$ICONS/monoform.png"
sed "s|^Exec=monoform|Exec=$BIN/monoform|" monoform.desktop >"$APPS/monoform.desktop"
chmod 644 "$APPS/monoform.desktop"
# "Open With → Quick peek": a small read-only window that can become the editor.
sed "s|^Exec=monoform|Exec=$BIN/monoform|" monoform-peek.desktop >"$APPS/monoform-peek.desktop"
chmod 644 "$APPS/monoform-peek.desktop"
refresh
echo "Installed to $BIN/monoform (also the monoform command)."

if [ "${1:-}" = "--set-default" ] && ! command -v xdg-mime >/dev/null 2>&1; then
  echo "xdg-mime (package xdg-utils) is not installed, so defaults were not changed." >&2
  exit 1
elif [ "${1:-}" = "--set-default" ]; then
  types=$(sed -n 's/^MimeType=//p' monoform.desktop | tr ';' ' ')
  for t in $types; do xdg-mime default monoform.desktop "$t"; done
  echo "Monoform is now the default app for its file types."
else
  echo "It is listed in Open With menus; run '$0 --set-default' to make it the default app for its file types."
fi
