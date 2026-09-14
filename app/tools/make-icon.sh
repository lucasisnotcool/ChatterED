#!/bin/bash
# Rebuild app/assets/AppIcon.icns (and a 1024px PNG for electron-builder) from app/assets/AppIcon.svg.
# Same pipeline as Scribe's tools/make-icon.sh. Needs rsvg-convert (brew install librsvg); iconutil ships with macOS.
set -e
cd "$(dirname "$0")/.."
SRC="assets/AppIcon.svg"; OUT="assets/AppIcon.icns"; PNG="assets/AppIcon.png"
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found — brew install librsvg" >&2; exit 1; }
SET=$(mktemp -d)/AppIcon.iconset; mkdir -p "$SET"
for spec in icon_16x16:16 icon_16x16@2x:32 icon_32x32:32 icon_32x32@2x:64 icon_128x128:128 icon_128x128@2x:256 icon_256x256:256 icon_256x256@2x:512 icon_512x512:512 icon_512x512@2x:1024; do
  name=${spec%%:*}; px=${spec##*:}
  rsvg-convert -w "$px" -h "$px" -o "$SET/$name.png" "$SRC"
done
iconutil -c icns -o "$OUT" "$SET"
rsvg-convert -w 1024 -h 1024 -o "$PNG" "$SRC"
rm -rf "$(dirname "$SET")"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)) and $PNG"
