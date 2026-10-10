import { loadPresets, savePresets, type Preset } from '../presets';
import { measure, type MeasureHandle } from './estimate';
import { frame } from './frame';
import { preview, type PreviewHandle } from './preview';
import { probe } from './probe';
import type { Progress } from './progress';
import { runConversion, type RunDeps, type RunHandle, type RunPhase } from './runner';
import type { FileInfo, Plan } from './types';

export interface Engine {
  probe(path: string): Promise<FileInfo>;
  run(info: FileInfo, plan: Plan, onProgress: (progress: Progress) => void, onPhase: (phase: RunPhase) => void): RunHandle;
  /** One packet scan and three short sample encodes, only the parts `need` asks for. */
  measure(info: FileInfo, plan: Plan, need: { packets: boolean; sample: boolean }): MeasureHandle;
  preview(info: FileInfo, plan: Plan): PreviewHandle;
  /** A picture from the video for the window, as a file in the cache folder. */
  frame(info: FileInfo): Promise<string | null>;
  readImage(path: string): Promise<Uint8Array>;
  presets: {
    load(): Promise<{ presets: Preset[]; warning: string | null }>;
    save(presets: Preset[]): Promise<void>;
  };
}

export function createEngine(deps: RunDeps): Engine {
  return {
    probe: (path) => probe(deps.spawner, path),
    run: (info, plan, onProgress, onPhase) => runConversion(info, plan, deps, onProgress, onPhase),
    measure: (info, plan, need) => measure(info, plan, need, deps),
    preview: (info, plan) => preview(info, plan, deps),
    frame: (info) => frame(info, deps),
    readImage: (path) => deps.files.readBytes(path),
    presets: {
      load: () => loadPresets(deps.files),
      save: (presets) => savePresets(deps.files, presets),
    },
  };
}
