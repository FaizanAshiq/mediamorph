# Mediamorph

Converts a video to MP4, MKV, MOV, WebM, M4A or MP3 without losing quality, one file at a time. Tracks the new format can hold are copied as they are, which takes seconds; only what has to change is re-encoded. Pick which audio and subtitle tracks to keep, burn subtitles in, save them as `.srt`, trade quality for size on a slider that shows the size as you move it, spend time instead of quality with Speed (Smallest file is about 20 percent smaller at the same look), set a target size or a loudness standard, and see a before and after frame before you start. Size and frame rate only ever go down, every result is checked before it gets its real name, and nothing is ever overwritten.

Mac first. Windows and Linux come later.

## Needs

A Mac with Apple silicon. ffmpeg, which does the converting, comes inside the app; see
`THIRD-PARTY-NOTICES.md`.

For development: Node, pnpm and Rust (`brew install rustup`, then `rustup default stable`).

## Updates

Mediamorph keeps itself up to date. Once a week it asks GitHub whether a newer version is out;
nothing about you or your files goes with the question. It downloads the new version, checks it is
signed exactly as itself, and puts it in place when you quit, so the next start is the new version.
Keep it in Applications: opened straight from Downloads, it offers to move itself there.

## Develop

| Command | Does |
| --- | --- |
| `./scripts/fetch-ffmpeg.sh` | Downloads the ffmpeg and ffprobe the app ships, checked against their pinned SHA-256. Needed before anything else |
| `pnpm install` | Installs the packages |
| `pnpm tauri dev` | Runs the app with live reload |
| `pnpm test` | Runs every test, including real conversions with the ffmpeg the app ships |
| `pnpm typecheck` | Type checks the app and the tests |
| `pnpm tauri build --bundles app` | Builds `src-tauri/target/release/bundle/macos/Mediamorph.app` |

Debug builds can drive themselves for end-to-end tests: launched with `MEDIAMORPH_E2E` set to a
test plan, they convert the file by themselves, write a report to `MEDIAMORPH_E2E_REPORT`, then
quit. The plan's shape is in `src/e2e.ts`. Release builds do not contain this.

## License

GPL-3.0-or-later. See `LICENSE`.
