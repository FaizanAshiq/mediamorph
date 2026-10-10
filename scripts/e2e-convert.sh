#!/usr/bin/env bash
# e2e-convert.sh <debug Mediamorph.app>: the debug build converting a clip by itself, as CI runs it.
# It makes a 720p clip with the ffmpeg inside the app, starts the app with a test plan that shrinks
# it to 480p, and checks the report: the copy inside the app did the work and the result is right.
set -euo pipefail
app=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
work=$(mktemp -d)
"$app/Contents/MacOS/ffmpeg" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30:duration=6 \
    -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -crf 23 -c:a aac -shortest "$work/clip.mkv"
plan="{\"file\":\"$work/clip.mkv\",\"settings\":{\"size\":480}}"
open -n -W --env "MEDIAMORPH_E2E=$plan" --env "MEDIAMORPH_E2E_REPORT=$work/report.json" "$app" &
waiter=$!
for _ in $(seq 1 180); do kill -0 "$waiter" 2>/dev/null || break; sleep 1; done
if kill -0 "$waiter" 2>/dev/null; then
    echo "FAIL the app did not finish in 3 minutes"
    exit 1
fi
node -e '
const r = require(process.argv[1]);
const checks = [
  ["the copy of ffmpeg inside the app did the work", r.tools?.ffmpeg === "binaries/ffmpeg"],
  ["it can burn text subtitles in", r.machine?.subtitlesFilter === true],
  ["the clip converted", r.file?.status === "done"],
  ["the result is 480p", r.file?.outputVideo?.height === 480],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log((ok ? "ok   " : "FAIL ") + name);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
' "$work/report.json"
