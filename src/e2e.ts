import { invoke } from '@tauri-apps/api/core';
import type { StoreApi } from 'zustand';
import type { ConvertState, Settings, Tools } from '@/features/convert';

/**
 * Test hook for debug builds. When launched with MEDIAMORPH_E2E set, the app opens the file by itself, does what
 * the plan says, writes a report and quits. Release builds lack the e2e commands, so the first invoke fails and
 * this does nothing.
 */
interface TestPlan {
  file: string;
  /** Applied before `settings`. */
  preset?: string;
  /** Changes on top of the settings; video, audio and subtitles merge one level deep. */
  settings?: SettingsPatch;
  /** Wait for the size and time estimate and report it. */
  estimate?: boolean;
  /** Make the before and after frames and report them. */
  preview?: boolean;
  /** Save the settings as a preset with this name. */
  savePreset?: string;
  /** Set false to stop after the estimate and preview. */
  convert?: boolean;
  /** Stop this long after starting, to test cleanup. */
  cancelAfterMs?: number;
  /** Quit the whole app this long after converting starts, to test the exit cleanup, or, with convert false, this long after the file opens. */
  exitAfterMs?: number;
  /** Stay open after the report, to look at the result. */
  keepOpen?: boolean;
  /** Show the window in this appearance. When it differs from the saved one, the app saves it and quits; launch it again. */
  appearance?: 'system' | 'light' | 'dark';
}

type SettingsPatch = Partial<Omit<Settings, 'video' | 'audio' | 'subtitles'>> & {
  video?: Partial<Settings['video']>;
  audio?: Partial<Settings['audio']>;
  subtitles?: Partial<Settings['subtitles']>;
};

let started = false;

export async function runTestPlan(tools: Tools | null, store: StoreApi<ConvertState> | null): Promise<void> {
  if (started) return;
  started = true;
  const raw = await invoke<string | null>('e2e_config').catch(() => null);
  if (!raw) return;
  const plan = JSON.parse(raw) as TestPlan;
  // A reload hides the window and WebKit then suspends the page, so the new appearance waits for the next launch.
  if (plan.appearance && localStorage.getItem('mediamorph.appearance') !== plan.appearance) {
    localStorage.setItem('mediamorph.appearance', plan.appearance);
    await invoke('e2e_exit');
    return;
  }
  const report = (body: object) => invoke('e2e_report', { report: JSON.stringify(body, null, 2) });

  if (!store) {
    await report({ tools });
    await invoke('e2e_exit');
    return;
  }

  const app = store.getState();
  await app.open([plan.file]);
  if (plan.preset) app.applyPreset(plan.preset);
  const settings = store.getState().file?.settings;
  if (plan.settings && settings) app.setSettings(merged(settings, plan.settings));

  let estimate: unknown;
  let preview: unknown;
  if (plan.estimate) {
    await until(store, (s) => s.file?.estimate !== undefined && !s.file.checking);
    estimate = store.getState().file?.estimate;
  }
  if (plan.preview) {
    app.showPreview();
    await until(store, (s) => s.preview?.status !== 'working');
    const shown = store.getState().preview;
    preview =
      shown?.status === 'ready'
        ? { ...shown, beforeBytes: (await app.readImage(shown.before)).length, afterBytes: (await app.readImage(shown.after)).length }
        : shown;
    app.closePreview();
  }
  if (plan.savePreset) await app.savePreset(plan.savePreset);

  if (plan.convert !== false) {
    const converting = app.convert();
    if (plan.cancelAfterMs) setTimeout(() => void app.stop(), plan.cancelAfterMs);
    if (plan.exitAfterMs) setTimeout(() => void invoke('e2e_exit'), plan.exitAfterMs);
    await converting;
  } else if (plan.exitAfterMs) {
    // Open and idle, as when an update waits for the app to quit.
    setTimeout(() => void invoke('e2e_exit'), plan.exitAfterMs);
  }

  const state = store.getState();
  const file = state.file;
  await report({
    tools,
    machine: {
      subtitlesFilter: state.machine.filters.has('subtitles'),
      encoders: state.machine.encoders.size,
      hardware: [...state.machine.encoders].filter((e) => e.includes('videotoolbox')),
    },
    presets: state.presets.map((p) => p.name),
    presetWarning: state.presetWarning,
    estimate,
    preview,
    file: file && {
      name: file.name,
      status: file.status,
      presetName: file.presetName,
      settings: file.settings,
      error: file.error,
      log: file.log,
      summary: file.plan?.summary,
      warnings: file.plan?.warnings,
      output: file.output?.path,
      outputVideo: file.output?.video,
      outputAudio: file.output?.audio,
      outputSubtitles: file.output?.subtitles,
      extras: file.extras,
      notes: file.notes,
      frame: file.frame,
    },
  });
  if (!plan.keepOpen) await invoke('e2e_exit');
}

function merged(settings: Settings, patch: SettingsPatch): Settings {
  return {
    ...settings,
    ...patch,
    video: { ...settings.video, ...patch.video },
    audio: { ...settings.audio, ...patch.audio },
    subtitles: { ...settings.subtitles, ...patch.subtitles },
  };
}

function until(store: StoreApi<ConvertState>, done: (state: ConvertState) => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done(store.getState())) return resolve();
    const off = store.subscribe((state) => {
      if (!done(state)) return;
      off();
      resolve();
    });
  });
}
