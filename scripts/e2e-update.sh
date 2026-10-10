#!/usr/bin/env bash
# e2e-update.sh <debug Mediamorph.app>: a copy updating itself as it quits, as CI runs it. The app,
# signed with the release certificate in a folder it can write to, starts with the same build one
# version on waiting in a test feed. It downloads it, checks it is signed exactly as itself, and when
# it quits the new version takes its place. Needs the "Tinysnap Release" identity in the keychain.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
work=$(mktemp -d)
app="$work/Applications/Mediamorph.app"
next="$work/next"
failed=0
check() {
    if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failed=1; fi
}
shown() { plutil -extract CFBundleShortVersionString raw "$1/Contents/Info.plist"; }

mkdir -p "$work/Applications" "$next"
ditto "$source" "$app"
ditto "$source" "$next/Mediamorph.app"
before=$(shown "$app")
version=$(echo "$before" | awk -F. '{print $1"."$2"."$3+1}')
plutil -replace CFBundleShortVersionString -string "$version" "$next/Mediamorph.app/Contents/Info.plist"
"$here/sign-mac.sh" "$app"
"$here/sign-mac.sh" "$next/Mediamorph.app"
ditto -c -k --keepParent "$next/Mediamorph.app" "$next/Mediamorph-mac.zip"
cat > "$next/latest.json" <<JSON
{"tag_name": "v$version", "assets": [{"name": "Mediamorph-mac.zip", "browser_download_url": "file://$next/Mediamorph-mac.zip"}]}
JSON
echo "     $before installed, $version waiting"

# A file open and nothing converting, as a person might leave it, until the plan quits the app.
"$app/Contents/MacOS/ffmpeg" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=640x360:rate=30:duration=2 \
    -c:v libx264 "$work/clip.mkv"
plan="{\"file\":\"$work/clip.mkv\",\"convert\":false,\"keepOpen\":true,\"exitAfterMs\":45000}"
open -n -W --env "MEDIAMORPH_E2E=$plan" --env "MEDIAMORPH_E2E_REPORT=$work/report.json" \
    --env "MEDIAMORPH_UPDATE_FEED=$next" "$app" &
waiter=$!
for _ in $(seq 1 120); do kill -0 "$waiter" 2>/dev/null || break; sleep 1; done
for _ in $(seq 1 30); do [ "$(shown "$app" 2>/dev/null)" = "$version" ] && break; sleep 1; done
sleep 2

marker="$HOME/Library/Application Support/com.faizanashiq.mediamorph/updated-to"
check "the app quit when its plan said" '! kill -0 "$waiter" 2>/dev/null'
check "the app in Applications is $version" '[ "$(shown "$app")" = "$version" ]'
check "it is still signed with the release certificate" 'codesign -dvv "$app" 2>&1 | grep -q "Authority=Tinysnap Release"'
check "the next start will say it was updated" '[ "$(cat "$marker" 2>/dev/null)" = "$version" ]'
check "nothing is left beside it" '[ ! -e "$app.replaced" ]'
exit $failed
