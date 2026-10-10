import { describe, expect, it } from 'vitest';
import type { FileInfo } from '../engine/types';
import { verifyOutput } from '../engine/verify';
import { makeInfo } from './support/fixtures';

const expect720 = { durationSec: 7440, audioTracks: 2, subtitleTracks: 1, video: { width: 1280, height: 534 } };
const out = (overrides: Partial<FileInfo> = {}) =>
  makeInfo({
    durationSec: 7440.4,
    video: { index: 0, codec: 'h264', width: 1280, height: 534, fps: 23.976, bitDepth: 8, hdr: 'sdr', rotation: 0 },
    ...overrides,
  });

describe('verifyOutput', () => {
  it('passes a matching file', () => {
    expect(verifyOutput(out(), expect720)).toEqual({ ok: true });
  });

  it('fails when the length is off by more than 1.5 s', () => {
    expect(verifyOutput(out({ durationSec: 7400 }), expect720)).toEqual({ ok: false, reason: 'it runs 7400.0 s, the original 7440.0 s' });
  });

  it('skips the length check when the source length was unknown', () => {
    expect(verifyOutput(out({ durationSec: 12 }), { ...expect720, durationSec: 0 })).toEqual({ ok: true });
  });

  it('fails on a missing audio track', () => {
    expect(verifyOutput(out({ audio: [] }), expect720)).toEqual({ ok: false, reason: 'it has 0 audio tracks instead of 2' });
  });

  it('fails on a missing subtitle track', () => {
    expect(verifyOutput(out({ subtitles: [] }), expect720)).toEqual({ ok: false, reason: 'it has 0 subtitle tracks instead of 1' });
  });

  it('fails on the wrong picture size or a missing video', () => {
    expect(verifyOutput(out(), { ...expect720, video: { width: 1280, height: 720 } })).toEqual({
      ok: false,
      reason: 'its picture is 1280x534 instead of 1280x720',
    });
    expect(verifyOutput(out({ video: null }), expect720)).toEqual({ ok: false, reason: 'its video track is missing' });
  });
});
