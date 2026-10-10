import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { Engine } from './engine/engine';
import { explainReadError } from './engine/errors';
import { missing, sizeFrom, type Estimate, type MeasureHandle, type Measures } from './engine/estimate';
import { plan } from './engine/planner';
import type { Comfort } from './engine/ports';
import type { Preview, PreviewHandle } from './engine/preview';
import type { Progress } from './engine/progress';
import type { RunHandle } from './engine/runner';
import { DEFAULT_SETTINGS, FULL_MACHINE, type FileInfo, type Machine, type Plan, type Settings } from './engine/types';
import { BUILT_IN_PRESETS, presetFrom, settingsFor, type Preset } from './presets';

export type FileStatus = 'probing' | 'ready' | 'measuring' | 'first-pass' | 'running' | 'verifying' | 'done' | 'failed' | 'cancelled';

/** The one file the window works on. */
export interface OpenFile {
  path: string;
  name: string;
  status: FileStatus;
  settings: Settings;
  /** The preset these settings came from, until the settings are changed by hand. */
  presetName: string | null;
  info?: FileInfo;
  plan?: Plan;
  progress?: Progress;
  error?: string;
  /** Raw ffprobe or ffmpeg lines behind `error`, for Show details. */
  log?: string[];
  output?: FileInfo;
  /** Files written next to the output, such as .srt subtitles. */
  extras?: string[];
  /** Things that went wrong without failing the conversion. */
  notes?: string[];
  /** Worked out at once from what has been measured; see `checking`. */
  estimate?: Estimate | null;
  /** A packet scan or sample encode is on its way to firm up `estimate`. */
  checking?: boolean;
  /** A picture from the video, saved in the cache folder. */
  frame?: string;
}

export type PreviewState = { status: 'working' } | ({ status: 'ready' } & Preview) | { status: 'none' };

export interface ConvertState {
  file: OpenFile | null;
  /** True from Convert until the run has fully stopped, cleanup included. */
  running: boolean;
  machine: Machine;
  presets: Preset[];
  presetWarning: string | null;
  preview: PreviewState | null;
  /** Said once when more than one file was dropped. */
  notice: string | null;
  /** Opens the first path, replacing the file shown; refused while converting. */
  open(paths: string[]): Promise<void>;
  setSettings(settings: Settings): void;
  applyPreset(name: string): void;
  savePreset(name: string): Promise<void>;
  showPreview(): void;
  closePreview(): void;
  readImage(path: string): Promise<Uint8Array>;
  convert(): Promise<void>;
  stop(): Promise<void>;
  /** From a finished file back to its settings, to convert it again differently. */
  editAgain(): void;
  close(): void;
}

export interface ConvertOptions {
  machine?: Machine;
  comfort?: Comfort;
  /** Wait after the last change before measuring; tests use 0. */
  estimateDelayMs?: number;
}

const EDITABLE: FileStatus[] = ['ready', 'failed', 'cancelled'];
const CONVERTIBLE: FileStatus[] = ['ready', 'failed', 'cancelled'];

/** Keeps track choices sensible: at least one audio track while the file has audio, and plays first on a kept track. */
function normalise(settings: Settings, info: FileInfo): Settings | null {
  const keep = settings.audio.keep;
  if (keep !== 'all' && keep.length === 0 && info.audio.length > 0) return null;
  const first = keep !== 'all' && settings.audio.first !== null && !keep.includes(settings.audio.first) ? (keep[0] ?? null) : settings.audio.first;
  return first === settings.audio.first ? settings : { ...settings, audio: { ...settings.audio, first } };
}

export function createConvertStore(engine: Engine, options: ConvertOptions = {}): StoreApi<ConvertState> {
  const machine = options.machine ?? FULL_MACHINE;
  const comfort = options.comfort;
  const delay = options.estimateDelayMs ?? 1000;
  let run: RunHandle | null = null;
  let converting: Promise<void> | null = null;
  let estimateTimer: ReturnType<typeof setTimeout> | null = null;
  let estimating: MeasureHandle | null = null;
  /** What has been measured for the open file, so returning to earlier settings needs no ffmpeg. */
  let measures: Measures = { samples: {} };
  let previewing: PreviewHandle | null = null;

  const store = createStore<ConvertState>()((set, get) => {
    /** Changes the open file, unless another file has been opened meanwhile. */
    const patch = (path: string, changes: Partial<OpenFile>) =>
      set((s) => (s.file?.path === path ? { file: { ...s.file, ...changes } } : {}));

    const planned = (info: FileInfo, settings: Settings): Partial<OpenFile> => {
      try {
        return { info, settings, plan: plan(info, settings, machine), status: 'ready', error: undefined, log: undefined };
      } catch (error) {
        return { info, settings, plan: undefined, status: 'failed', error: messageOf(error), log: undefined };
      }
    };

    const stopEstimate = () => {
      if (estimateTimer) clearTimeout(estimateTimer);
      estimateTimer = null;
      estimating?.cancel();
      estimating = null;
    };

    /**
     * Works out the size at once from what is already measured, then measures whatever is missing a moment after
     * the settings settle. Never measures while converting.
     */
    const scheduleEstimate = () => {
      stopEstimate();
      const file = get().file;
      if (!file?.info || !file.plan || file.status !== 'ready') return;
      const { path, info, plan: filePlan } = file;
      const need = missing(filePlan, measures);
      const checking = !get().running && (need.packets || need.sample);
      patch(path, { estimate: sizeFrom(info, filePlan, measures), checking });
      if (!checking) return;
      estimateTimer = setTimeout(() => {
        const handle = engine.measure(info, filePlan, need);
        estimating = handle;
        void handle.result.then((found) => {
          if (estimating !== handle) return;
          estimating = null;
          if (found) measures = { packets: found.packets ?? measures.packets, samples: { ...measures.samples, ...found.samples } };
          const now = get().file;
          if (now?.path === path && now.info && now.plan) patch(path, { estimate: sizeFrom(now.info, now.plan, measures), checking: false });
        });
      }, delay);
    };

    const replan = (changes: Partial<OpenFile> = {}) => {
      const file = get().file;
      if (!file?.info) return;
      patch(file.path, { ...planned(file.info, file.settings), ...changes });
    };

    return {
      file: null,
      running: false,
      machine,
      presets: BUILT_IN_PRESETS,
      presetWarning: null,
      preview: null,
      notice: null,

      async open(paths) {
        const path = paths[0];
        if (!path || get().running) return;
        stopEstimate();
        get().closePreview();
        measures = { samples: {} };
        const name = path.split(/[\\/]/).pop() ?? path;
        set({
          file: { path, name, status: 'probing', settings: DEFAULT_SETTINGS, presetName: 'Keep original quality' },
          notice: paths.length > 1 ? `Mediamorph converts one file at a time, so only ${name} was opened.` : null,
        });
        let info: FileInfo;
        try {
          info = await engine.probe(path);
        } catch (error) {
          patch(path, { status: 'failed', error: explainReadError(messageOf(error)), log: [messageOf(error)] });
          return;
        }
        patch(path, planned(info, DEFAULT_SETTINGS));
        scheduleEstimate();
        const frame = await engine.frame(info).catch(() => null);
        if (frame) patch(path, { frame });
      },

      setSettings(settings) {
        const file = get().file;
        if (!file?.info || !EDITABLE.includes(file.status)) return;
        const tidy = normalise(settings, file.info);
        if (!tidy) return;
        patch(file.path, { ...planned(file.info, tidy), presetName: null });
        scheduleEstimate();
      },

      applyPreset(name) {
        const preset = get().presets.find((p) => p.name === name);
        const file = get().file;
        if (!preset || !file?.info || !EDITABLE.includes(file.status)) return;
        patch(file.path, { ...planned(file.info, settingsFor(preset, file.info)), presetName: name });
        scheduleEstimate();
      },

      async savePreset(name) {
        const file = get().file;
        if (!file?.info || !name.trim()) return;
        const saved = get().presets.filter((p) => !p.builtIn && p.name !== name.trim());
        const next = [...saved, presetFrom(name.trim(), file.settings, file.info)];
        await engine.presets.save(next);
        set({ presets: [...BUILT_IN_PRESETS, ...next] });
        patch(file.path, { presetName: name.trim() });
      },

      showPreview() {
        previewing?.cancel();
        const file = get().file;
        if (!file?.info || !file.plan) return;
        set({ preview: { status: 'working' } });
        const handle = engine.preview(file.info, file.plan);
        previewing = handle;
        void handle.result.then((shot) => {
          if (previewing !== handle) return;
          previewing = null;
          set({ preview: shot ? { status: 'ready', ...shot } : { status: 'none' } });
        });
      },

      readImage: (path) => engine.readImage(path),

      closePreview() {
        previewing?.cancel();
        previewing = null;
        set({ preview: null });
      },

      async convert() {
        const file = get().file;
        if (converting || !file?.info || !CONVERTIBLE.includes(file.status)) return converting ?? undefined;
        // A failed or cancelled file is planned afresh, so Try again starts clean.
        const fresh = planned(file.info, file.settings);
        if (!fresh.plan) return patch(file.path, fresh);
        const { path, info } = file;
        stopEstimate();
        set({ running: true });
        patch(path, { ...fresh, status: 'running', progress: undefined, checking: false });
        // The run starts before anything awaits, so a Stop straight after Convert has something to stop.
        const handle = engine.run(
          info,
          fresh.plan,
          (progress) => patch(path, { progress }),
          (phase) => patch(path, { status: phase }),
        );
        run = handle;
        converting = (async () => {
          await comfort?.keepAwake(true);
          const result = await handle.result;
          run = null;
          if (result.status === 'done') patch(path, { status: 'done', output: result.output, extras: result.extras, notes: result.warnings, progress: undefined });
          if (result.status === 'cancelled') patch(path, { status: 'cancelled', progress: undefined });
          if (result.status === 'failed') patch(path, { status: 'failed', error: result.reason, log: result.log, progress: undefined });
          set({ running: false });
          converting = null;
          await comfort?.keepAwake(false);
          if (result.status === 'done') await comfort?.notify('Mediamorph', `${file.name} converted`);
          if (result.status === 'failed') await comfort?.notify('Mediamorph', `${file.name} could not be converted`);
          scheduleEstimate();
        })();
        return converting;
      },

      async stop() {
        if (!converting) return;
        await run?.cancel();
        // Waits for the run to delete its unfinished file, so quitting right after never leaves one behind.
        await converting;
      },

      editAgain() {
        if (get().file?.status !== 'done') return;
        replan({ output: undefined, extras: undefined, notes: undefined });
        scheduleEstimate();
      },

      close() {
        if (get().running) return;
        stopEstimate();
        get().closePreview();
        measures = { samples: {} };
        set({ file: null, notice: null });
      },
    };
  });

  void engine.presets.load().then(({ presets, warning }) => {
    store.setState({ presets: [...BUILT_IN_PRESETS, ...presets], presetWarning: warning });
  });
  return store;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const ConvertContext = createContext<StoreApi<ConvertState> | null>(null);

export function useConvert<T>(selector: (state: ConvertState) => T): T {
  const store = useContext(ConvertContext);
  if (!store) throw new Error('useConvert needs a ConvertContext provider');
  return useStore(store, selector);
}
