#!/usr/bin/env bash
# Package the Universal Party Chrome extension into a shareable zip.
# Includes only the files needed to run the extension (no dev/test files),
# plus INSTALL.md for the recipient. Output: dist/universal-party-extension-v<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/UPE-frontend"
DIST="$ROOT/dist"
NAME="universal-party-extension"
VERSION="$(node -p "require('$SRC/manifest.json').version" 2>/dev/null || echo "1.0")"
STAGE="$DIST/$NAME"
ZIP="$DIST/$NAME-v$VERSION.zip"

# Runnable extension files (everything the manifest references, nothing else).
FILES=(
  manifest.json
  background.js
  contentScript.js
  popup.html
  popup.js
  sidebar.css
  styles.css
  video-chat.html
  video-chat.js
  libs/socket.io.min.js
  libs/peerjs.min.js
)

echo "Packaging $NAME v$VERSION ..."
rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/libs"

for f in "${FILES[@]}"; do
  if [[ ! -f "$SRC/$f" ]]; then echo "  MISSING: $f" >&2; exit 1; fi
  cp "$SRC/$f" "$STAGE/$f"
done
cp "$ROOT/INSTALL.md" "$STAGE/INSTALL.md"

# Archive root is the extension folder, so recipients unzip → Load unpacked.
( cd "$DIST" && zip -r -X "$(basename "$ZIP")" "$NAME" -x "*.DS_Store" >/dev/null )
rm -rf "$STAGE"

echo "Done → $ZIP"
( cd "$DIST" && unzip -l "$(basename "$ZIP")" )
