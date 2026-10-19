#!/bin/sh
# Install Hold It All for the current user (no root needed):
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
  rm -f "$BIN/hold-it-all" "$APPS/hold-it-all.desktop" "$ICONS/hold-it-all.png"
  refresh
  echo "Removed. Settings stay in ~/.config/HoldItAll; the optional search model and indexes in ~/.cache/HoldItAll."
  exit 0
  ;;
--set-default | "") ;;
*)
  echo "usage: $0 [--set-default | --uninstall]" >&2
  exit 2
  ;;
esac

mkdir -p "$BIN" "$APPS" "$ICONS"
install -m 755 hold-it-all "$BIN/hold-it-all"
install -m 644 hold-it-all.png "$ICONS/hold-it-all.png"
sed "s|^Exec=hold-it-all|Exec=$BIN/hold-it-all|" hold-it-all.desktop >"$APPS/hold-it-all.desktop"
chmod 644 "$APPS/hold-it-all.desktop"
refresh
echo "Installed to $BIN/hold-it-all."

if [ "${1:-}" = "--set-default" ] && ! command -v xdg-mime >/dev/null 2>&1; then
  echo "xdg-mime (package xdg-utils) is not installed, so defaults were not changed." >&2
  exit 1
elif [ "${1:-}" = "--set-default" ]; then
  types=$(sed -n 's/^MimeType=//p' hold-it-all.desktop | tr ';' ' ')
  for t in $types; do xdg-mime default hold-it-all.desktop "$t"; done
  echo "Hold It All is now the default app for its file types."
else
  echo "It is listed in Open With menus; run '$0 --set-default' to make it the default app for its file types."
fi
