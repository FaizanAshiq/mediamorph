// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measure, missing, sizeFrom, sampleStarts } from '../engine/estimate';
import { plan } from '../engine/planner';
import { preview } from '../engine/preview';
import { probe } from '../engine/probe';
import { runConversion } from '../engine/runner';
import { DEFAULT_SETTINGS, type FileInfo, type Plan, type Settings } from '../engine/types';
import { nodeFiles, nodeSpawner } from './support/node';

const deps = { spawner: nodeSpawner, files: nodeFiles };
let dir = '';

function clip(name: string, seconds: number): string {
  const path = join(dir, name);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1920x800:rate=24:duration=${seconds},noise=alls=8:allf=t`,
    '-f', 'lavfi', '-i', `sine=f=440:duration=${seconds}`,
    '-map', '0', '-map', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', path,
  ]);
  return path;
}

const at720: Settings = { ...DEFAULT_SETTINGS, size: 720 };
const quality = (q: number): Settings => ({ ...at720, video: { ...at720.video, rate: { mode: 'quality', quality: q } } });

/** Measures what the plan needs, then works out its size from that alone. */
async function measured(info: FileInfo, p: Plan) {
  const found = await measure(info, p, missing(p, { samples: {} }), deps).result;
  return { found: found!, size: sizeFrom(info, p, found!) };
}

async function realSize(info: FileInfo, p: Plan): Promise<number> {
  const result = await runConversion(info, p, deps, () => {}, () => {}).result;
  if (result.status !== 'done') throw new Error(`The conversion did not finish: ${JSON.stringify(result)}`);
  return (await stat(result.output.path)).size;
}

describe('sampleStarts', () => {
  it('samples three spots in a long file and the start of a short one', () => {
    expect(sampleStarts(100)).toEqual([20, 50, 80]);
    expect(sampleStarts(20)).toEqual([0]);
  });
});

describe('estimates and previews with real ffmpeg', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mediamorph-estimate-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('estimates a copy from packet sizes, close to the real result', async () => {
    const source = clip('copy.mkv', 5);
    const info = await probe(nodeSpawner, source);
    const p = plan(info, DEFAULT_SETTINGS);
    const { size } = await measured(info, p);
    const real = await realSize(info, p);
    expect(size?.kind).toBe('exact');
    expect(Math.abs(size!.bytes - real) / real).toBeLessThan(0.05);
  });

  it('estimates a re-encode from samples within 15 percent', async () => {
    const source = clip('encode.mkv', 40);
    const info = await probe(nodeSpawner, source);
    const p = plan(info, at720);
    const { size } = await measured(info, p);
    const real = await realSize(info, p);
    expect(size?.kind).toBe('measured');
    expect(Math.abs(size!.bytes - real) / real).toBeLessThan(0.15);
    expect(size!.seconds).toBeGreaterThan(0);
  }, 240000);

  // Synthetic clips compress too evenly for this, so it runs on a real film when one is named.
  const film = process.env.MEDIAMORPH_TEST_FILM ?? '';
  it.skipIf(!film || !existsSync(film))('works out a slider move on real film from one sample, within 20 percent', async () => {
    const source = join(dir, 'film.mkv');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '600', '-i', film, '-t', '60', '-map', '0', '-c', 'copy', source]);
    const info = await probe(nodeSpawner, source);
    const at480 = (q: number) => plan(info, { ...quality(q), size: 480 });
    const { found } = await measured(info, at480(100));
    const worked = sizeFrom(info, at480(70), found)!;
    const real = await realSize(info, at480(70));
    expect(worked.kind).toBe('guess');
    expect(Math.abs(worked.bytes - real) / real).toBeLessThan(0.2);
  }, 240000);

  it('stops an estimate when cancelled', async () => {
    const source = clip('cancel.mkv', 60);
    const info = await probe(nodeSpawner, source);
    const handle = measure(info, plan(info, at720), { packets: true, sample: true }, deps);
    handle.cancel();
    expect(await handle.result).toBeNull();
  });

  it('makes two 10 s clips, before and after, at the output size, for the window to play side by side', async () => {
    const source = clip('preview.mkv', 40);
    const info = await probe(nodeSpawner, source);
    const clips = await preview(info, plan(info, at720), deps).result;
    expect(clips).toMatchObject({ width: 1280, height: 534 });
    for (const path of [clips!.before, clips!.after]) {
      expect(path.endsWith('.mp4')).toBe(true);
      const made = await probe(nodeSpawner, path);
      expect(made.video).toMatchObject({ codec: 'h264', width: 1280, height: 534 });
      expect(made.audio).toHaveLength(0);
      expect(Math.abs(made.durationSec - 10)).toBeLessThan(0.5);
    }
  }, 120000);

  it('shows an AV1 result through a near-lossless H.264 copy, since older Macs cannot play AV1', async () => {
    const source = clip('preview-av1.mkv', 40);
    const info = await probe(nodeSpawner, source);
    const av1 = plan(info, { ...at720, video: { ...at720.video, codec: 'av1' } });
    const clips = await preview(info, av1, deps).result;
    expect((await probe(nodeSpawner, clips!.after)).video?.codec).toBe('h264');
  }, 120000);

  it('has no preview for a copy, since nothing changes', async () => {
    const source = clip('same.mkv', 3);
    const info = await probe(nodeSpawner, source);
    expect(await preview(info, plan(info, DEFAULT_SETTINGS), deps).result).toBeNull();
  });
});
