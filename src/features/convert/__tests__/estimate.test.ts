import { describe, expect, it } from 'vitest';
import { missing, sampleKey, sizeFrom, type Measures, type VideoSample } from '../engine/estimate';
import { plan } from '../engine/planner';
import { DEFAULT_SETTINGS, type Settings } from '../engine/types';
import { nightTrainInfo } from './support/fixtures';

const info = nightTrainInfo();
/** Night Train's longest track, which is how long the output runs. */
const LEN = 7602.901;
const hindiOnly = (changes: (s: Settings) => void = () => {}): Settings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.audio.keep = [1];
  s.subtitles.keep = [];
  changes(s);
  return s;
};
const burnAt = (quality: number) => hindiOnly((s) => {
  s.subtitles.burn = 3;
  s.video.rate = { mode: 'quality', quality };
});
const packets = { 0: 7e8, 1: 1.8e8, 2: 9e7, 3: 1e6 };
const sampleOf = (p: ReturnType<typeof plan>, bytesPerSec: number, speed = 2.5): Measures['samples'] => ({
  [sampleKey(p)!]: { bytesPerSec, speed, rate: p.videoRate } satisfies VideoSample,
});

describe('sizes worked out without encoding', () => {
  it('is exact for a copy once the packets are scanned', () => {
    const p = plan(info, hindiOnly());
    expect(sizeFrom(info, p, { packets, samples: {} })).toEqual({
      bytes: (7e8 + 1.8e8) * 1.01,
      seconds: ((7e8 + 1.8e8) * 1.01) / 150e6,
      kind: 'exact',
      videoKbps: (7e8 * 8) / LEN / 1000,
    });
  });

  it('guesses a copy from the bitrates the file gives, before the scan', () => {
    const e = sizeFrom(info, plan(info, hindiOnly()), { samples: {} })!;
    expect(e.kind).toBe('guess');
    expect(e.bytes).toBeCloseTo(((732462 + 191789) * LEN) / 8, -3);
  });

  it('needs nothing new when an audio track is unticked after the scan', () => {
    expect(missing(plan(info, hindiOnly()), { packets, samples: {} })).toEqual({ packets: false, sample: false });
    expect(missing(plan(info, DEFAULT_SETTINGS), { samples: {} })).toEqual({ packets: true, sample: false });
    expect(missing(plan(info, burnAt(100)), { packets, samples: {} })).toEqual({ packets: false, sample: true });
  });

  it('uses a sample of these very settings as measured', () => {
    const p = plan(info, burnAt(100));
    const e = sizeFrom(info, p, { packets, samples: sampleOf(p, 80000) })!;
    expect(e.kind).toBe('measured');
    expect(e.bytes).toBeCloseTo(80000 * LEN + 1.8e8 * 1.01, -3);
    expect(e.seconds).toBeCloseTo(LEN / 2.5, 3);
  });

  it('works out a slider move at once from the nearest sample: 6 CRF steps halve an x265 file', () => {
    const measured = { packets, samples: sampleOf(plan(info, burnAt(100)), 80000) };
    const e = sizeFrom(info, plan(info, burnAt(70)), measured)!;
    expect(e.kind).toBe('guess');
    expect(e.bytes).toBeCloseTo(40000 * LEN + 1.8e8 * 1.01, -3);
    expect(e.seconds).toBeCloseTo(LEN / 2.5, 3);
  });

  it('learns how fast this file shrinks once two positions are measured', () => {
    const at100 = plan(info, burnAt(100));
    const at40 = plan(info, burnAt(40));
    // CRF 22 at 60 kB/s and CRF 34 at 7.5 kB/s: this file halves every 4 steps, not 6. Both sit well under their caps.
    const measured = { packets, samples: { ...sampleOf(at100, 60000), ...sampleOf(at40, 7500) } };
    expect(sizeFrom(info, plan(info, burnAt(70)), measured)!.bytes).toBeCloseTo(60000 * 2 ** (-6 / 4) * LEN + 1.8e8 * 1.01, -3);
  });

  it('leaves a sample held down by the cap out of the learning', () => {
    const measured = { packets, samples: { ...sampleOf(plan(info, burnAt(100)), 88000), ...sampleOf(plan(info, burnAt(40)), 7500) } };
    // 704 kbps is within 15 percent of the 732 kbps cap, so the typical 6 steps a halving holds.
    expect(sizeFrom(info, plan(info, burnAt(70)), measured)!.bytes).toBeCloseTo(88000 * 2 ** -1 * LEN + 1.8e8 * 1.01, -3);
  });

  it('works out Smallest file from a Balanced sample, with its measured size and time factors', () => {
    const balanced = plan(info, burnAt(100));
    const measured = { packets, samples: sampleOf(balanced, 60000) };
    const smallest = plan(info, hindiOnly((s) => {
      s.subtitles.burn = 3;
      s.video.speed = 'smallest';
    }));
    const e = sizeFrom(info, smallest, measured)!;
    // x265 slow is 1.13 times the size at the same CRF, three CRF steps up halve it by 2^(3/6), and it takes 2.7 times as long.
    expect(e.bytes).toBeCloseTo(60000 * 1.13 * 2 ** (-3 / 6) * LEN + 1.8e8 * 1.01, -3);
    expect(e.seconds).toBeCloseTo((LEN / 2.5) * 2.7, 1);
  });

  it('carries the video bitrate: the original for a copy, the sample or the worked-out one for a re-encode, none for sound only', () => {
    expect(sizeFrom(info, plan(info, hindiOnly()), { samples: {} })!.videoKbps).toBeCloseTo(732.462, 3);
    const at100 = plan(info, burnAt(100));
    const measured = { packets, samples: sampleOf(at100, 80000) };
    expect(sizeFrom(info, at100, measured)!.videoKbps).toBeCloseTo(640, 6);
    expect(sizeFrom(info, plan(info, burnAt(70)), measured)!.videoKbps).toBeCloseTo(320, 6);
    expect(sizeFrom(info, plan(info, hindiOnly((s) => void (s.format = 'm4a'))), { packets, samples: {} })!.videoKbps).toBeNull();
  });

  it('never works out more than the cap when moving up the slider', () => {
    const measured = { packets, samples: sampleOf(plan(info, burnAt(40)), 30000) };
    // 240 kbps at CRF 34 would be 960 kbps at CRF 22, but the original is 732 kbps.
    expect(sizeFrom(info, plan(info, burnAt(100)), measured)!.bytes).toBeCloseTo((732 * 1000 * LEN) / 8 + 1.8e8 * 1.01, -3);
  });

  it('scales a smaller picture by its pixels, and speeds it up', () => {
    const measured = { packets, samples: sampleOf(plan(info, burnAt(100)), 80000) };
    const small = sizeFrom(info, plan(info, hindiOnly((s) => {
      s.subtitles.burn = 3;
      s.size = 480;
    })), measured)!;
    const pixels = (854 * 352) / (1280 * 528);
    expect(small.bytes).toBeCloseTo(80000 * pixels ** 0.75 * LEN + 1.8e8 * 1.01, -3);
    expect(small.seconds).toBeCloseTo(LEN / (2.5 / pixels), 3);
  });

  it('knows the size of fast mode before any sample, but not its time', () => {
    const e = sizeFrom(info, plan(info, hindiOnly((s) => {
      s.subtitles.burn = 3;
      s.video.speed = 'fast';
    })), { packets, samples: {} })!;
    expect(e.bytes).toBeCloseTo((732 * 1000 * LEN) / 8 + 1.8e8 * 1.01, -3);
    expect(e.seconds).toBeNull();
    expect(e.kind).toBe('guess');
  });

  it('starts from typical film when nothing has been measured, never above the cap', () => {
    // 1280x528 at 23.976 fps and 0.05 bits a pixel is 810 kbps, over Night Train's 732.
    const e = sizeFrom(info, plan(info, burnAt(100)), { packets, samples: {} })!;
    expect(e.bytes).toBeCloseTo((732 * 1000 * LEN) / 8 + 1.8e8 * 1.01, -3);
    expect(e.seconds).toBeNull();
  });
});
