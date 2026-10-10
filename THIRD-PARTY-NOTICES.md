# Third-party notices

Mediamorph's download carries ffmpeg and ffprobe inside the app, and runs them to do the
converting.

## FFmpeg 9.0.2

Static builds for Apple silicon by Martin Riedl, configured with `--enable-gpl --enable-version3`,
so they are distributed under the GNU General Public License, version 3 or later: the same licence
as Mediamorph, in `LICENSE`.

| | Where |
| --- | --- |
| The binaries, and the SHA-256 Mediamorph pins them by | https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ (`ffmpeg.zip`, `ffprobe.zip`) |
| Their exact configuration and library versions | `versions.txt` in that folder |
| FFmpeg's source | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz |
| How they were built, with every library's source | https://git.martin-riedl.de/ffmpeg/build-script |

Built in, each under its own licence: aom 3.15.0, dav1d 1.5.4, fontconfig 2.17.1, FreeType 2.13.0,
FriBidi 1.0.16, HarfBuzz 14.4.0, LAME 4.0, libass 0.17.5, libbluray 1.5.0, libklvanc 1.6.0,
libtheora 1.2.0, libvmaf 3.2.0, libvorbis 1.3.7, libwebp 1.6.0, libxml2 2.15.3, OpenH264 2.6.0,
OpenJPEG 2.5.4, OpenSSL 3.6.4, Opus 1.6.1, rav1e 0.8.1, Snappy 1.2.2, SRT 1.5.7, SVT-AV1 4.2.0,
VVenC 1.14.0, libvpx 1.16.0, x264 0.165, x265 4.2, zimg 3.0.6, zlib 1.3.2 and zvbi 0.2.35.

If any of these sources stops being available, open an issue on this repository and the complete
corresponding source will be provided.
