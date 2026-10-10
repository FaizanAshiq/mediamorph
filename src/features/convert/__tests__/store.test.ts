import { describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../engine/runner';
import { DEFAULT_SETTINGS } from '../engine/types';
import { createConvertStore } from '../store';
import { fakeComfort, fakeEngine } from './support/fakes';

const quick = { estimateDelayMs: 0 };
const status = (store: ReturnType<typeof createConvertStore>) => store.getState().file?.status;

/** A run that ends like the real runner: its temp file is deleted a moment after the kill. */
function slowToStop(runs: string[] = []) {
  let cleanedUp = false;
  const run = (info: { path: string }) => {
    runs.push(info.path);
    let finish: (result: RunResult) => void = () => {};
    const result = new Promise<RunResult>((resolve) => (finish = resolve));
    const cancel = async () =>
      void setTimeout(() => {
        cleanedUp = true;
        finish({ status: 'cancelled' });
      }, 20);
    return { result, cancel };
  };
  return { run, cleanedUp: () => cleanedUp };
}

describe('one file at a time', () => {
  it('opens and plans a file, with a picture from it', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/Night Train.mkv']);
    expect(store.getState().file).toMatchObject({ name: 'Night Train.mkv', status: 'ready', frame: '/cache/frame-1.jpg', presetName: 'Keep original quality' });
    expect(store.getState().file?.plan?.summary[0]).toBe('Video: copied, no quality loss');
  });

  it('replaces the open file with the next one, and says so when several are dropped', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await store.getState().open(['/m/b.mkv', '/m/c.mkv']);
    expect(store.getState().file?.name).toBe('b.mkv');
    expect(store.getState().notice).toBe('Mediamorph converts one file at a time, so only b.mkv was opened.');
    await store.getState().open(['/m/c.mkv']);
    expect(store.getState().notice).toBeNull();
  });

  it('keeps the file it is converting when another is dropped', async () => {
    const store = createConvertStore(fakeEngine({ holdRuns: true }).engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const converting = store.getState().convert();
    await store.getState().open(['/m/b.mkv']);
    expect(store.getState().file?.name).toBe('a.mkv');
    await store.getState().stop();
    await converting;
  });

  it('explains a file it cannot read in plain words, keeping the raw message', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/notes.txt']);
    expect(store.getState().file).toMatchObject({ status: 'failed', log: ['Invalid data found when processing input'] });
    expect(store.getState().file?.error).not.toContain('Invalid data');
  });

  it('converts, keeping the Mac awake and saying when it is done', async () => {
    const { comfort, calls } = fakeComfort();
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, { ...quick, comfort });
    await store.getState().open(['/m/Night Train.mkv']);
    await store.getState().convert();
    expect(status(store)).toBe('done');
    expect(store.getState().running).toBe(false);
    expect(calls).toEqual(['awake true', 'awake false', 'notify Mediamorph: Night Train.mkv converted']);
  });

  it('says when a conversion failed', async () => {
    const { comfort, calls } = fakeComfort();
    const { engine } = fakeEngine();
    engine.run = () => ({ result: Promise.resolve({ status: 'failed', reason: 'The disk is full.', log: [] }), cancel: async () => {} });
    const store = createConvertStore(engine, { ...quick, comfort });
    await store.getState().open(['/m/a.mkv']);
    await store.getState().convert();
    expect(store.getState().file).toMatchObject({ status: 'failed', error: 'The disk is full.' });
    expect(calls[calls.length - 1]).toBe('notify Mediamorph: a.mkv could not be converted');
  });

  it('stop waits until the run has cleaned up, so quitting never leaves a partial file', async () => {
    const { engine } = fakeEngine();
    const slow = slowToStop();
    engine.run = slow.run;
    const store = createConvertStore(engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const converting = store.getState().convert();
    await vi.waitFor(() => expect(status(store)).toBe('running'));
    await store.getState().stop();
    expect(slow.cleanedUp()).toBe(true);
    expect(status(store)).toBe('cancelled');
    await converting;
  });

  it('a second Convert while stopping never starts another run', async () => {
    const { engine } = fakeEngine();
    const runs: string[] = [];
    engine.run = slowToStop(runs).run;
    const store = createConvertStore(engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const converting = store.getState().convert();
    await vi.waitFor(() => expect(status(store)).toBe('running'));
    const stopping = store.getState().stop();
    void store.getState().convert();
    await stopping;
    await converting;
    expect(runs).toEqual(['/m/a.mkv']);
    expect(store.getState().running).toBe(false);
  });

  it('converts again after Stop, from the same settings', async () => {
    const fake = fakeEngine({ holdRuns: true });
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const first = store.getState().convert();
    await store.getState().stop();
    await first;
    expect(status(store)).toBe('cancelled');
    const second = store.getState().convert();
    await vi.waitFor(() => expect(status(store)).toBe('running'));
    expect(fake.runs).toEqual(['/m/a.mkv', '/m/a.mkv']);
    await store.getState().stop();
    await second;
  });

  it('replans when settings change, but not while converting or done; Edit again reopens them', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/a.mkv']);
    store.getState().setSettings({ ...DEFAULT_SETTINGS, size: 480 });
    expect(store.getState().file?.plan?.summary[0]).toBe('Video: shrunk to 854x352, re-encoded as HEVC, looks the same, no bigger than the original');
    await store.getState().convert();
    store.getState().setSettings(DEFAULT_SETTINGS);
    expect(store.getState().file?.settings.size).toBe(480);
    store.getState().editAgain();
    expect(store.getState().file).toMatchObject({ status: 'ready', output: undefined });
    store.getState().setSettings(DEFAULT_SETTINGS);
    expect(store.getState().file?.settings.size).toBe('original');
  });

  it('closes back to the empty window, but not while converting', async () => {
    const store = createConvertStore(fakeEngine({ holdRuns: true }).engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const converting = store.getState().convert();
    store.getState().close();
    expect(store.getState().file).not.toBeNull();
    await store.getState().stop();
    await converting;
    store.getState().close();
    expect(store.getState().file).toBeNull();
  });

  it('moves plays first to a kept track when its track is unticked, and refuses to untick the last one', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/a.mkv']);
    const settings = store.getState().file!.settings;
    store.getState().setSettings({ ...settings, audio: { ...settings.audio, first: 1, keep: [2] } });
    expect(store.getState().file?.settings.audio.first).toBe(2);
    store.getState().setSettings({ ...settings, audio: { ...settings.audio, keep: [] } });
    expect(store.getState().file?.settings.audio.keep).toEqual([2]);
  });

  it('passes the measuring step through as a status', async () => {
    const statuses: string[] = [];
    const store = createConvertStore(fakeEngine({ holdRuns: true }).engine, quick);
    store.subscribe((s) => statuses.push(s.file?.status ?? ''));
    await store.getState().open(['/m/a.mkv']);
    const settings = store.getState().file!.settings;
    store.getState().setSettings({ ...settings, audio: { ...settings.audio, loudness: 'streaming' } });
    const converting = store.getState().convert();
    await vi.waitFor(() => expect(statuses).toContain('measuring'));
    await store.getState().stop();
    await converting;
  });

  it('shows extra files and warnings when done', async () => {
    const fake = fakeEngine({ doneWith: { extras: ['/m/a.eng.srt'], warnings: ['The original could not be moved to the Trash.'] } });
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await store.getState().convert();
    expect(store.getState().file).toMatchObject({ status: 'done', extras: ['/m/a.eng.srt'], notes: ['The original could not be moved to the Trash.'] });
  });
});

describe('sizes', () => {
  const COPY_BYTES = (7e8 + 1.8e8 + 9e7) * 1.01;
  const settled = async (store: ReturnType<typeof createConvertStore>) =>
    vi.waitFor(() => expect(store.getState().file?.checking).toBe(false), { interval: 5 });

  it('shows a size at once, then firms it up with one measurement', async () => {
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    expect(store.getState().file).toMatchObject({ checking: true, estimate: { kind: 'guess' } });
    await settled(store);
    expect(store.getState().file?.estimate).toMatchObject({ bytes: COPY_BYTES, seconds: COPY_BYTES / 150e6, kind: 'exact' });
    expect(fake.measures).toHaveLength(1);
  });

  it('cancels a measurement still running when the settings change', async () => {
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await vi.waitFor(() => expect(fake.measures).toHaveLength(1), { interval: 5 });
    store.getState().setSettings({ ...store.getState().file!.settings, size: 480 });
    expect(fake.cancels()).toBe(1);
    await settled(store);
    expect(store.getState().file?.estimate?.kind).toBe('measured');
  });

  it('works out track changes, earlier settings and slider moves without measuring again', async () => {
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await settled(store);
    store.getState().setSettings({ ...DEFAULT_SETTINGS, size: 480 });
    await settled(store);
    const measuredAt480 = store.getState().file!.estimate!.bytes;
    expect(fake.measures).toHaveLength(2);

    const at480 = store.getState().file!.settings;
    store.getState().setSettings({ ...at480, video: { ...at480.video, rate: { mode: 'quality', quality: 70 } } });
    expect(store.getState().file?.estimate).toMatchObject({ kind: 'guess' });
    expect(store.getState().file!.estimate!.bytes).toBeLessThan(measuredAt480);

    store.getState().setSettings({ ...at480, audio: { ...at480.audio, keep: [1] } });
    expect(store.getState().file!.estimate!.bytes).toBeCloseTo(measuredAt480 - 9e7 * 1.01, -3);
    store.getState().setSettings(DEFAULT_SETTINGS);
    expect(store.getState().file).toMatchObject({ checking: false, estimate: { bytes: COPY_BYTES, kind: 'exact' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.measures).toHaveLength(2);
  });

  it('never measures while converting, and keeps the size it had', async () => {
    const fake = fakeEngine({ holdRuns: true });
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await settled(store);
    const before = fake.measures.length;
    const converting = store.getState().convert();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.measures.length).toBe(before);
    expect(store.getState().file?.estimate?.kind).toBe('exact');
    await store.getState().stop();
    await converting;
  });

  it('starts measuring afresh for a newly opened file', async () => {
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await settled(store);
    await store.getState().open(['/m/b.mkv']);
    expect(store.getState().file).toMatchObject({ checking: true, estimate: { kind: 'guess' } });
    await settled(store);
    expect(fake.measures).toEqual(['/m/a.mkv', '/m/b.mkv']);
  });
});

describe('presets and preview', () => {
  it('applies a preset, and names it until the settings are changed by hand', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/a.mkv']);
    store.getState().applyPreset('720p for phones');
    expect(store.getState().file).toMatchObject({ presetName: '720p for phones', settings: { size: 720 } });
    store.getState().setSettings({ ...store.getState().file!.settings, size: 480 });
    expect(store.getState().file?.presetName).toBeNull();
  });

  it('saves a preset from the file and lists it after the built-ins', async () => {
    const fake = fakeEngine();
    const store = createConvertStore(fake.engine, quick);
    await store.getState().open(['/m/a.mkv']);
    await store.getState().savePreset('My MKV');
    expect(store.getState().presets.map((p) => p.name).slice(-1)).toEqual(['My MKV']);
    expect(fake.saved[0].map((p) => p.name)).toEqual(['My MKV']);
    expect(store.getState().file?.presetName).toBe('My MKV');
  });

  it('makes a preview of the open file', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    await store.getState().open(['/m/a.mkv']);
    store.getState().setSettings({ ...DEFAULT_SETTINGS, size: 480 });
    store.getState().showPreview();
    await vi.waitFor(() =>
      expect(store.getState().preview).toEqual({ status: 'ready', before: '/cache/preview-before.mp4', after: '/cache/preview-after.mp4', width: 854, height: 352 }),
    );
    store.getState().closePreview();
    expect(store.getState().preview).toBeNull();
  });
});
