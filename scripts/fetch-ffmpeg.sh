#!/usr/bin/env bash
# fetch-ffmpeg.sh: puts the ffmpeg and ffprobe that Mediamorph ships in src-tauri/binaries, where
# Tauri takes them into the app, and links them as plain ffmpeg and ffprobe in
# src-tauri/binaries/bin, which the tests put first on PATH. They are Martin Riedl's static builds
# of ffmpeg 9.0.2 for Apple silicon, pinned by SHA-256; a download that does not match is refused.
set -euo pipefail
cd "$(dirname "$0")/.."
base=https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2
out=src-tauri/binaries
mkdir -p "$out/bin"

fetch() {
    local name=$1 sha=$2
    local file="$out/$name-aarch64-apple-darwin"
    ln -sf "../$name-aarch64-apple-darwin" "$out/bin/$name"
    # Already here from this pinned zip.
    [ -x "$file" ] && [ "$(cat "$file.sha256" 2>/dev/null)" = "$sha" ] && return
    curl -fsSL "$base/$name.zip" -o "$out/$name.zip"
    if ! echo "$sha  $out/$name.zip" | shasum -a 256 -c - >/dev/null; then
        echo "$name.zip does not match its pinned SHA-256" >&2
        rm -f "$out/$name.zip"
        exit 1
    fi
    ditto -x -k "$out/$name.zip" "$out"
    rm -f "$out/$name.zip"
    mv "$out/$name" "$file"
    chmod +x "$file"
    echo "$sha" > "$file.sha256"
}

fetch ffmpeg c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924
fetch ffprobe fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6
