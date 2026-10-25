#!/bin/sh
# Install Monoform for the current user (no root needed):
#   ./install.sh                 install; the app appears in "Open With" menus, and
#                                "Convert with Monoform…" in the file manager's right-click menu
#   ./install.sh --set-default   also make it the default app for its file types
#   ./install.sh --uninstall     remove it again
set -eu
cd "$(dirname "$0")"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"
# Right-click "Convert with Monoform…": Dolphin (service menu), Nautilus (Scripts), Nemo (actions).
KDE_MENUS="$DATA/kio/servicemenus"
NAUTILUS_SCRIPT="$DATA/nautilus/scripts/Convert with Monoform…"
NEMO_ACTION="$DATA/nemo/actions/monoform-convert.nemo_action"
ICONS="$DATA/icons/hicolor/512x512/apps"

refresh() {
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$APPS" || true; fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t "$DATA/icons/hicolor" || true; fi
}

case "${1:-}" in
--uninstall)
  rm -f "$BIN/monoform" "$APPS/monoform.desktop" "$APPS/monoform-peek.desktop" "$APPS/monoform-convert.desktop" "$ICONS/monoform.png"
  rm -f "$KDE_MENUS/monoform-convert.desktop" "$NAUTILUS_SCRIPT" "$NEMO_ACTION"
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
# "Convert with Monoform…": a small window that converts the selected files
# next to them. In Open With everywhere; in the right-click menu of Dolphin,
# Nautilus (Scripts) and Nemo.
sed "s|^Exec=monoform|Exec=$BIN/monoform|" monoform-convert.desktop >"$APPS/monoform-convert.desktop"
chmod 644 "$APPS/monoform-convert.desktop"
mkdir -p "$KDE_MENUS" "$(dirname "$NAUTILUS_SCRIPT")" "$(dirname "$NEMO_ACTION")"
sed "s|^Exec=monoform|Exec=$BIN/monoform|" monoform-convert-servicemenu.desktop >"$KDE_MENUS/monoform-convert.desktop"
chmod 755 "$KDE_MENUS/monoform-convert.desktop" # Plasma 6 runs only executable service menus
printf '#!/bin/sh\n# Nautilus › Scripts: convert the selected files with Monoform.\nexec "%s" --convert "$@"\n' "$BIN/monoform" >"$NAUTILUS_SCRIPT"
chmod 755 "$NAUTILUS_SCRIPT"
cat >"$NEMO_ACTION" <<EOF
[Nemo Action]
Name=Convert with Monoform…
Comment=Convert the selected files to another format, next to them
Exec=$BIN/monoform --convert %F
Icon-Name=monoform
Selection=notnone
Extensions=png;jpg;jpeg;gif;webp;bmp;tif;tiff;ico;icns;heic;heif;avif;mp3;wav;flac;ogg;oga;csv;tsv;xlsx;xlsm;xls;ods;json;md;markdown;txt;docx;doc;odt;
EOF
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
