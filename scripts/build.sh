#!/usr/bin/env bash
# Build the frontend and the desktop binary for the current OS.
# On Linux with WebKitGTK 4.1 (Ubuntu 24.04+, Fedora 40+) the webkit2_41 tag is required.
set -euo pipefail
cd "$(dirname "$0")/.."
TAGS=${TAGS:-}
if [ "$(uname -s)" = "Linux" ] && pkg-config --exists webkit2gtk-4.1 2>/dev/null; then TAGS="webkit2_41${TAGS:+,$TAGS}"; fi
(cd frontend && npm run build)
WAILS=${WAILS:-$(command -v wails || echo "$HOME/go/bin/wails")}
"$WAILS" build -s ${TAGS:+-tags "$TAGS"} "$@"
# The monoform command-line program, next to the app.
go build -trimpath -o build/bin/monoform-cli ./cmd/monoform-cli
