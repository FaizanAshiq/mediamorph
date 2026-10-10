import { describe, expect, it } from 'vitest';
import type { FileOps } from '../engine/ports';
import { DEFAULT_SETTINGS } from '../engine/types';
import { BUILT_IN_PRESETS, loadPresets, presetFrom, savePresets, settingsFor } from '../presets';
import { nightTrainInfo, makeInfo } from './support/fixtures';

function memoryFiles(start: Record<string, string> = {}): FileOps & { saved: Record<string, string> } {
  const saved = { ...start };
  return {
    saved,
    exists: async (p) => p in saved,
    rename: async () => {},
    remove: async () => {},
    freeBytes: async () => null,
    markUnfinished: async () => {},
    cacheDir: async () => '/cache',
    configDir: async () => '/config',
    readText: async (p) => saved[p] ?? null,
    writeText: async (p, text) => void (saved[p] = text),
    readBytes: async () => new Uint8Array(),
    trash: async () => {},
  };
}

describe('presets', () => {
  it('ships the everyday and delivery presets', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.name)).toEqual([
      'Keep original quality',
      'Smaller, looks the same',
      '720p for phones',
      'YouTube upload',
      'EU TV master',
      'US TV master',
    ]);
    expect(BUILT_IN_PRESETS[0].settings).toEqual(DEFAULT_SETTINGS);
    expect(BUILT_IN_PRESETS[4].settings.audio).toMatchObject({ loudness: 'eu-tv', addStereo: true });
    expect(BUILT_IN_PRESETS[1].settings.video).toMatchObject({ codec: 'hevc', speed: 'smallest' });
  });

  it('turns a preset into settings for one file, with the language rule resolved', () => {
    const hindiFirst = { ...BUILT_IN_PRESETS[0], name: 'Hindi first', builtIn: false, firstLanguage: 'eng' };
    expect(settingsFor(hindiFirst, nightTrainInfo()).audio.first).toBe(2);
    expect(settingsFor(hindiFirst, makeInfo({ audio: [{ index: 1, codec: 'aac', channels: 2, language: 'jpn' }] })).audio.first).toBeNull();
  });

  it('saves a file as a preset of rules, not track numbers', () => {
    const settings = { ...DEFAULT_SETTINGS, size: 720 as const, audio: { ...DEFAULT_SETTINGS.audio, keep: [1, 2], first: 2 } };
    expect(presetFrom('Mine', settings, nightTrainInfo())).toEqual({
      name: 'Mine',
      builtIn: false,
      firstLanguage: 'eng',
      settings: { ...settings, audio: { ...settings.audio, keep: 'all', first: null }, subtitles: { ...settings.subtitles, keep: 'auto' } },
    });
  });

  it('saves and loads presets in the config folder', async () => {
    const files = memoryFiles();
    const mine = presetFrom('Mine', { ...DEFAULT_SETTINGS, format: 'mkv' }, nightTrainInfo());
    await savePresets(files, [mine]);
    expect(Object.keys(files.saved)).toEqual(['/config/presets.json']);
    expect(await loadPresets(files)).toEqual({ presets: [mine], warning: null });
  });

  it('keeps going with the built-ins when the saved file is damaged, leaving it untouched', async () => {
    const files = memoryFiles({ '/config/presets.json': 'not json' });
    expect(await loadPresets(files)).toEqual({ presets: [], warning: 'Saved presets could not be read' });
    expect(files.saved['/config/presets.json']).toBe('not json');
  });

  it('reads presets saved before the quality slider, turning the old levels into slider positions', async () => {
    const old = (level: string) => ({ name: level, builtIn: false, settings: { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, rate: { mode: 'quality', level } } } });
    const files = memoryFiles({ '/config/presets.json': JSON.stringify({ version: 1, presets: [old('same'), old('smaller'), old('smallest')] }) });
    const { presets } = await loadPresets(files);
    expect(presets.map((p) => p.settings.video.rate)).toEqual([
      { mode: 'quality', quality: 100 },
      { mode: 'quality', quality: 70 },
      { mode: 'quality', quality: 40 },
    ]);
  });

  it('reads presets saved before the Speed setting: the best encoder is Balanced, fast is Fast', async () => {
    const old = (encoder: string) => {
      const { speed: _speed, ...video } = DEFAULT_SETTINGS.video;
      return { name: encoder, builtIn: false, settings: { ...DEFAULT_SETTINGS, video: { ...video, encoder } } };
    };
    const files = memoryFiles({ '/config/presets.json': JSON.stringify({ version: 1, presets: [old('best'), old('fast')] }) });
    const { presets } = await loadPresets(files);
    expect(presets.map((p) => p.settings.video.speed)).toEqual(['balanced', 'fast']);
    expect(presets[0].settings.video).not.toHaveProperty('encoder');
  });

  it('loads nothing when there is no saved file yet', async () => {
    expect(await loadPresets(memoryFiles())).toEqual({ presets: [], warning: null });
  });
});
