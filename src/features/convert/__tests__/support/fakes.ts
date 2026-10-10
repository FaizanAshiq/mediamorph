import type { Engine } from '../../engine/engine';
import { sampleKey, type Measures } from '../../engine/estimate';
import type { Comfort } from '../../engine/ports';
import type { RunResult } from '../../engine/runner';
import type { Preset } from '../../presets';
import { nightTrainInfo } from './fixtures';

/** Probes any `.mkv` as Night Train and fails anything else. Runs finish at once unless `holdRuns` is set. */
export function fakeEngine({ holdRuns = false, doneWith = {} as { extras?: string[]; warnings?: string[] } } = {}) {
  const runs: string[] = [];
  const measures: string[] = [];
  const saved: Preset[][] = [];
  let estimateCancels = 0;
  const engine: Engine = {
    probe: async (path) => {
      if (!path.endsWith('.mkv')) throw new Error('Invalid data found when processing input');
      return nightTrainInfo(path);
    },
    run: (info, plan, onProgress, onPhase) => {
      runs.push(info.path);
      if (plan.steps.some((s) => s.kind === 'measure-loudness')) onPhase('measuring');
      onPhase('running');
      onProgress({ fraction: 0.5, etaSec: 90 });
      let finish: (result: RunResult) => void = () => {};
      const done: RunResult = { status: 'done', output: { ...info, path: info.path.replace('.mkv', '.mp4') }, extras: doneWith.extras ?? [], warnings: doneWith.warnings ?? [] };
      const result = holdRuns ? new Promise<RunResult>((resolve) => (finish = resolve)) : Promise.resolve(done);
      return { result, cancel: async () => finish({ status: 'cancelled' }) };
    },
    measure: (info, plan, need) => {
      measures.push(info.path);
      let cancelled = false;
      const found: Measures = { samples: {} };
      if (need.packets) found.packets = { 0: 7e8, 1: 1.8e8, 2: 9e7, 3: 1e6 };
      const key = sampleKey(plan);
      if (need.sample && key) found.samples[key] = { bytesPerSec: 80000, speed: 2.5, rate: plan.videoRate };
      const result: Promise<Measures | null> = new Promise((resolve) => setTimeout(() => resolve(cancelled ? null : found), 150));
      return {
        result,
        cancel: () => {
          cancelled = true;
          estimateCancels++;
        },
      };
    },
    preview: () => ({ result: Promise.resolve({ before: '/cache/preview-before.mp4', after: '/cache/preview-after.mp4', width: 854, height: 352 }), cancel: () => {} }),
    frame: async () => '/cache/frame-1.jpg',
    readImage: async () => new Uint8Array([1, 2, 3]),
    presets: {
      load: async () => ({ presets: [], warning: null }),
      save: async (presets) => void saved.push(presets),
    },
  };
  return { engine, runs, measures, saved, cancels: () => estimateCancels };
}

export function fakeComfort() {
  const calls: string[] = [];
  const comfort: Comfort = {
    keepAwake: async (on) => void calls.push(`awake ${on}`),
    notify: async (title, body) => void calls.push(`notify ${title}: ${body}`),
  };
  return { comfort, calls };
}
