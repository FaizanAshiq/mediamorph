import type { Expectation, FileInfo } from './types';

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const DURATION_TOLERANCE_SEC = 1.5;

export function verifyOutput(out: FileInfo, expect: Expectation): VerifyResult {
  if (expect.durationSec && Math.abs(out.durationSec - expect.durationSec) > DURATION_TOLERANCE_SEC) {
    return { ok: false, reason: `it runs ${out.durationSec.toFixed(1)} s, the original ${expect.durationSec.toFixed(1)} s` };
  }
  if (out.audio.length !== expect.audioTracks) {
    return { ok: false, reason: `it has ${out.audio.length} audio tracks instead of ${expect.audioTracks}` };
  }
  if (out.subtitles.length !== expect.subtitleTracks) {
    return { ok: false, reason: `it has ${out.subtitles.length} subtitle tracks instead of ${expect.subtitleTracks}` };
  }
  if (!expect.video) return { ok: true };
  if (!out.video) return { ok: false, reason: 'its video track is missing' };
  const { width, height } = expect.video;
  if (out.video.width !== width || out.video.height !== height) {
    return { ok: false, reason: `its picture is ${out.video.width}x${out.video.height} instead of ${width}x${height}` };
  }
  return { ok: true };
}
