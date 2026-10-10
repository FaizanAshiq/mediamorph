// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plan } from '../engine/planner';
import { probe } from '../engine/probe';
import { runConversion, type RunHandle, type RunResult } from '../engine/runner';
import { DEFAULT_SETTINGS, type Settings } from '../engine/types';
import { nodeFiles, nodeSpawner } from './support/node';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
})();
const deps = { spawner: nodeSpawner, files: nodeFiles };
const at720: Settings = { ...DEFAULT_SETTINGS, size: 720 };
let dir = '';

/** `stretchTo` rescales after generating, since the test pattern itself rounds odd sizes down to even. */
function makeClip(name: string, { size = '1920x800', seconds = 3, audio = 'aac', video = 'libx264', stretchTo = '' } = {}): string {
  const path = join(dir, name);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=f=440:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=f=880:duration=${seconds}`,
    '-map', '0', '-map', '1', '-map', '2',
    ...(stretchTo ? ['-vf', `scale=${stretchTo}`, '-pix_fmt', 'yuv444p'] : []),
    '-c:v', video, ...(video === 'libx264' ? ['-preset', 'ultrafast'] : []), '-c:a', audio,
    '-metadata:s:a:0', 'language=hin', '-metadata:s:a:1', 'language=eng',
    path,
  ]);
  return path;
}

async function convert(source: string, settings: Settings = DEFAULT_SETTINGS): Promise<RunResult> {
  const info = await probe(nodeSpawner, source);
  return runConversion(info, plan(info, settings), deps, () => {}, () => {}).result;
}

const leftovers = async (prefix: string, keep: string[]) =>
  (await readdir(dir)).filter((f) => f.startsWith(prefix) && !keep.includes(f));

describe.skipIf(!hasFfmpeg)('runConversion with real ffmpeg', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mediamorph-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('copies a file MP4 can hold, keeping both audio tracks and their languages', async () => {
    const result = await convert(makeClip('copy me.mkv'));
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.output.path).toBe(join(dir, 'copy me.mp4'));
    expect(result.output.video).toMatchObject({ codec: 'h264', width: 1920, height: 800 });
    expect(result.output.audio.map((a) => a.language)).toEqual(['hin', 'eng']);
    expect(await leftovers('copy me', ['copy me.mkv', 'copy me.mp4'])).toEqual([]);
  });

  it('shrinks a wide 1080p clip to 1280x534', async () => {
    const result = await convert(makeClip('shrink me.mkv'), at720);
    expect(result.status === 'done' && result.output.video).toMatchObject({ width: 1280, height: 534 });
  });

  it('shrinks a portrait phone video by its on-screen shape', async () => {
    const flat = makeClip('phone flat.mp4', { size: '1920x1080' });
    const phone = join(dir, 'phone.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', flat, '-c', 'copy', phone]);
    const result = await convert(phone, at720);
    expect(result).toMatchObject({ status: 'done', output: { video: { width: 720, height: 1280 } } });
  });

  it('passes the length check when a dropped subtitle runs past the picture', async () => {
    const clip = makeClip('late subs clip.mkv', { seconds: 3 });
    const srt = join(dir, 'late subs.srt');
    await writeFile(srt, '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:08,000 --> 00:00:09,000\nStill here\n');
    const source = join(dir, 'late subs.mkv');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', source]);
    expect(await convert(source)).toMatchObject({ status: 'done' });
  });

  it('refuses a real photo', async () => {
    const photo = join(dir, 'holiday.jpg');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-frames:v', '1', photo]);
    const info = await probe(nodeSpawner, photo);
    expect(() => plan(info, DEFAULT_SETTINGS)).toThrow('This is a picture, not a video.');
  });

  it('re-encodes an odd-sized picture MP4 cannot hold', async () => {
    const result = await convert(makeClip('odd.mkv', { size: '640x360', stretchTo: '641:361', video: 'ffv1' }));
    expect(result).toMatchObject({ status: 'done', output: { video: { codec: 'h264', width: 640, height: 360 } } });
  });

  it('converts FLAC to AAC and copes with a name holding spaces, an apostrophe and an accent', async () => {
    const result = await convert(makeClip("Tom's Movie ü.mkv", { audio: 'flac' }));
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.output.path).toBe(join(dir, "Tom's Movie ü.mp4"));
    expect(result.output.audio.map((a) => a.codec)).toEqual(['aac', 'aac']);
  });

  it('never overwrites an MP4 source', async () => {
    const source = makeClip('already.mp4');
    const before = await readFile(source);
    const result = await convert(source, at720);
    expect(result.status === 'done' && result.output.path).toBe(join(dir, 'already (2).mp4'));
    expect((await readFile(source)).equals(before)).toBe(true);
  });

  it('cancel stops ffmpeg and leaves no files behind', async () => {
    const source = makeClip('long.mkv', { seconds: 60 });
    const info = await probe(nodeSpawner, source);
    let handle: RunHandle | undefined;
    await new Promise<void>((firstProgress) => {
      handle = runConversion(info, plan(info, at720), deps, () => firstProgress(), () => {});
    });
    await handle?.cancel();
    expect((await handle?.result)?.status).toBe('cancelled');
    expect(await leftovers('long', ['long.mkv'])).toEqual([]);
  });

  it('discards the output when the checks fail', async () => {
    const source = makeClip('broken.mkv');
    const info = await probe(nodeSpawner, source);
    const wrong = { ...plan(info, DEFAULT_SETTINGS) };
    wrong.expect = { ...wrong.expect, audioTracks: 5 };
    const result = await runConversion(info, wrong, deps, () => {}, () => {}).result;
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'The finished file failed its check: it has 2 audio tracks instead of 5. It was deleted; the original is untouched.',
    });
    expect(await leftovers('broken', ['broken.mkv'])).toEqual([]);
  });

  it('stops before starting when the disk is too full for the copy', async () => {
    const source = makeClip('full disk.mkv');
    const info = await probe(nodeSpawner, source);
    const tight = { ...deps, files: { ...nodeFiles, freeBytes: async () => 1000 } };
    const result = await runConversion(info, plan(info, DEFAULT_SETTINGS), tight, () => {}, () => {}).result;
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.status === 'failed' && result.reason).toMatch(/^Not enough free space: this needs about \d+ MB and the disk has 0 MB free\./);
    expect(await leftovers('full disk', ['full disk.mkv'])).toEqual([]);
  });

  it('marks the unfinished file while converting so an app exit can clean it up', async () => {
    const source = makeClip('marked.mkv');
    const info = await probe(nodeSpawner, source);
    const marks: (string | null)[] = [];
    const tracked = { ...deps, files: { ...nodeFiles, markUnfinished: async (path: string | null) => void marks.push(path) } };
    await runConversion(info, plan(info, DEFAULT_SETTINGS), tracked, () => {}, () => {}).result;
    expect(marks).toEqual([join(dir, 'marked.mediamorph-partial.mp4'), null]);
  });

  it('clears a partial file left behind by a crash', async () => {
    const source = makeClip('stale.mkv');
    await writeFile(join(dir, 'stale.mediamorph-partial.mp4'), 'junk');
    const result = await convert(source);
    expect(result.status === 'done' && result.output.path).toBe(join(dir, 'stale.mp4'));
    expect(await leftovers('stale', ['stale.mkv', 'stale.mp4'])).toEqual([]);
  });
});
