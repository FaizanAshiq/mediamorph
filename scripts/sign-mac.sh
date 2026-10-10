#!/usr/bin/env bash
# sign-mac.sh <Mediamorph.app> [identity]: signs ffmpeg and ffprobe, then the app around them, with
# one certificate, "Tinysnap Release" unless another is named. A copy of Mediamorph installs only an
# update signed exactly as itself, so every download is signed this way.
set -euo pipefail
app=$1
identity=${2:-Tinysnap Release}
for tool in ffmpeg ffprobe; do
    codesign --force --sign "$identity" "$app/Contents/MacOS/$tool"
done
codesign --force --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
