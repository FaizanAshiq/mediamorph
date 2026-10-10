// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMachine } from '../engine/machine';
import { plan } from '../engine/planner';
import { probe } from '../engine/probe';
import { runConversion, type RunResult } from '../engine/runner';
import type { Spawner } from '../engine/ports';
import { DEFAULT_SETTINGS, type Settings } from '../engine/types';
import { nodeFiles, nodeSpawner } from './support/node';

let dir = '';
type Done = Extract<RunResult, { status: 'done' }>;

const settings = (patch: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
};

function ffmpeg(args: string[], bin = 'ffmpeg') {
  execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** A 1920x800 clip with Hindi and English sound, an English SRT, and more when asked. */
async function movie(name: string, { seconds = 4, channels = 2, volume = 1, extra = [] as string[] } = {}): Promise<string> {
  const srt = join(dir, `${name}.srt`);
  await writeFile(srt, '1\n00:00:00,500 --> 00:00:03,500\nHello there\n');
  const path = join(dir, name);
  ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=1920x800:rate=24:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=f=440:duration=${seconds},volume=${volume}`,
    '-f', 'lavfi', '-i', `sine=f=880:duration=${seconds},volume=${volume}`,
    '-i', srt,
    '-map', '0', '-map', '1', '-map', '2', '-map', '3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-ac', String(channels), ...extra,
    '-metadata:s:a:0', 'language=hin', '-metadata:s:a:1', 'language=eng', '-metadata:s:s:0', 'language=eng',
    path,
  ]);
  return path;
}

async function convert(source: string, s: Settings, spawner: Spawner = nodeSpawner): Promise<RunResult> {
  const machine = await probeMachine(spawner);
  const info = await probe(spawner, source);
  return runConversion(info, plan(info, s, machine), { spawner, files: nodeFiles }, () => {}, () => {}).result;
}

async function done(source: string, s: Settings, spawner: Spawner = nodeSpawner): Promise<Done> {
  const result = await convert(source, s, spawner);
  if (result.status !== 'done') throw new Error(JSON.stringify(result));
  return result;
}

function measuredLoudness(path: string): number {
  const out = execFileSync('bash', ['-c', `ffmpeg -hide_banner -nostdin -i "$1" -map 0:a:0 -af ebur128 -f null - 2>&1 | grep -E '^\\s+I:' | tail -1`, '_', path], { encoding: 'utf8' });
  return Number(/I:\s+(-?[\d.]+)/.exec(out)?.[1] ?? NaN);
}

describe('steps 2 to 5 with real ffmpeg', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mediamorph-features-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps chosen tracks, marks the one that plays first, and keeps the SRT in the MP4', async () => {
    const result = await done(await movie('tracks.mkv'), settings((s) => {
      s.audio.keep = [2];
      s.subtitles.keep = [3];
    }));
    expect(result.output.audio.map((a) => a.language)).toEqual(['eng']);
    expect(result.output.subtitles).toMatchObject([{ codec: 'mov_text', language: 'eng' }]);
  });

  it('saves the SRT beside the video', async () => {
    const result = await done(await movie('srt out.mkv'), settings((s) => void (s.subtitles.saveSrt = true)));
    expect(result.extras).toEqual([join(dir, 'srt out.eng.srt')]);
    expect(await readFile(result.extras[0], 'utf8')).toContain('Hello there');
  });

  it('burns a text subtitle in, whatever the file is called', async () => {
    const source = await movie("Tom's: [cut], 1.mkv");
    const result = await done(source, settings((s) => void (s.subtitles.burn = 3)));
    expect(result.output.subtitles).toEqual([]);
    expect(result.output.video?.codec).toBe('h264');
  }, 120000);

  // ffmpeg cannot write PGS subtitles, so this runs on a film that has them when one is named.
  const pgsFilm = process.env.MEDIAMORPH_TEST_PGS_FILM ?? '';
  it.skipIf(!pgsFilm || !existsSync(pgsFilm))('burns an image subtitle in, using 30 s of a film with PGS subtitles', async () => {
    const source = join(dir, 'image subs.mkv');
    ffmpeg(['-ss', '600', '-i', pgsFilm, '-t', '30', '-map', '0', '-c', 'copy', source]);
    const info = await probe(nodeSpawner, source);
    expect(info.subtitles[0].kind).toBe('image');
    const result = await done(source, settings((s) => void (s.subtitles.burn = 3)));
    expect(result.output.subtitles).toEqual([]);
  }, 120000);

  it.each(['mkv', 'mov', 'webm', 'm4a', 'mp3'] as const)('converts to %s', async (format) => {
    const result = await done(await movie(`format ${format}.mkv`, { seconds: 2 }), settings((s) => void (s.format = format)));
    expect(result.output.path.endsWith(`.${format}`)).toBe(true);
  }, 120000);

  it('sets loudness to the streaming target', async () => {
    const result = await done(await movie('quiet.mkv', { seconds: 12, volume: 0.05 }), settings((s) => void (s.audio.loudness = 'streaming')));
    expect(Math.abs(measuredLoudness(result.output.path) - -14)).toBeLessThanOrEqual(0.5);
  }, 120000);

  it('adds a stereo track made from 5.1', async () => {
    const result = await done(await movie('surround.mkv', { channels: 6 }), settings((s) => void (s.audio.addStereo = true)));
    expect(result.output.audio.map((a) => a.channels)).toEqual([6, 6, 2]);
  }, 120000);

  it('lands close to a target size in two passes', async () => {
    const source = join(dir, 'target.mkv');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=30,noise=alls=12:allf=t', '-f', 'lavfi', '-i', 'sine=duration=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-c:a', 'aac', source]);
    const result = await done(source, settings((s) => void (s.video.rate = { mode: 'target', bytes: 5e6 })));
    const size = (await stat(result.output.path)).size;
    expect(Math.abs(size - 5e6) / 5e6).toBeLessThan(0.1);
  }, 240000);

  it('keeps HDR10 when shrinking a 4K HDR video', async () => {
    // ffmpeg writes HDR colour tags into MP4 but not into MKV, so the source is an MP4.
    const source = join(dir, 'hdr.mp4');
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24:duration=1', '-pix_fmt', 'yuv420p10le',
      '-c:v', 'libx265', '-preset', 'ultrafast',
      '-x265-params', 'hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,400:log-level=error',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', source,
    ]);
    const info = await probe(nodeSpawner, source);
    expect(info.video).toMatchObject({ hdr: 'hdr10', bitDepth: 10 });
    expect(info.video?.hdrMeta?.maxCll).toBe('1000,400');
    const result = await done(source, settings((s) => void (s.size = 1080)));
    expect(result.output.video).toMatchObject({ codec: 'hevc', hdr: 'hdr10', bitDepth: 10, width: 1920, height: 1080 });
  }, 240000);

  it('uses the Mac hardware encoder in fast mode', async () => {
    const result = await done(await movie('fast.mkv', { seconds: 2 }), settings((s) => {
      s.size = 720;
      s.video.speed = 'fast';
    }));
    expect(result.output.video).toMatchObject({ codec: 'h264', width: 1280, height: 534 });
  }, 120000);
});
