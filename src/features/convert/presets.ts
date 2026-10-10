import type { FileOps } from './engine/ports';
import { DEFAULT_SETTINGS, type FileInfo, type Settings } from './engine/types';

/** Settings that apply to any file: track choices are rules ('all', 'auto', a first language), never track numbers. */
export interface Preset {
  name: string;
  builtIn: boolean;
  settings: Settings;
  /** Language whose first track plays first, such as 'hin'. */
  firstLanguage?: string;
}

const tweak = (patch: (s: Settings) => void): Settings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
};

export const BUILT_IN_PRESETS: Preset[] = [
  { name: 'Keep original quality', builtIn: true, settings: DEFAULT_SETTINGS },
  {
    name: 'Smaller, looks the same',
    builtIn: true,
    settings: tweak((s) => {
      s.video.codec = 'hevc';
      s.video.speed = 'smallest';
    }),
  },
  {
    name: '720p for phones',
    builtIn: true,
    settings: tweak((s) => {
      s.size = 720;
      s.video.codec = 'h264';
    }),
  },
  {
    name: 'YouTube upload',
    builtIn: true,
    settings: tweak((s) => {
      s.video.codec = 'h264';
      s.audio.loudness = 'streaming';
    }),
  },
  {
    name: 'EU TV master',
    builtIn: true,
    settings: tweak((s) => {
      s.video.codec = 'h264';
      s.audio.loudness = 'eu-tv';
      s.audio.addStereo = true;
    }),
  },
  {
    name: 'US TV master',
    builtIn: true,
    settings: tweak((s) => {
      s.video.codec = 'h264';
      s.audio.loudness = 'us-tv';
      s.audio.addStereo = true;
    }),
  },
];

export function settingsFor(preset: Preset, info: FileInfo): Settings {
  const settings = structuredClone(preset.settings);
  if (preset.firstLanguage) settings.audio.first = info.audio.find((a) => a.language === preset.firstLanguage)?.index ?? null;
  return settings;
}

export function presetFrom(name: string, settings: Settings, info: FileInfo): Preset {
  const first = info.audio.find((a) => a.index === settings.audio.first);
  return {
    name,
    builtIn: false,
    ...(first ? { firstLanguage: first.language } : {}),
    settings: {
      ...settings,
      audio: { ...settings.audio, keep: 'all', first: null },
      subtitles: { ...settings.subtitles, keep: 'auto', burn: null },
    },
  };
}

const FILE = 'presets.json';

export async function loadPresets(files: FileOps): Promise<{ presets: Preset[]; warning: string | null }> {
  const text = await files.readText(`${await files.configDir()}/${FILE}`);
  if (text === null) return { presets: [], warning: null };
  try {
    const saved = JSON.parse(text) as { presets?: Preset[] };
    if (!Array.isArray(saved.presets)) throw new Error('no presets list');
    return { presets: saved.presets.map((p) => ({ ...p, builtIn: false, settings: withSpeed(withSliderQuality(p.settings)) })), warning: null };
  } catch {
    return { presets: [], warning: 'Saved presets could not be read' };
  }
}

/** Presets saved before the quality slider hold a level word; each becomes the slider position it matches. */
const OLD_LEVELS: Record<string, number> = { same: 100, smaller: 70, smallest: 40 };

function withSliderQuality(settings: Settings): Settings {
  const rate = settings.video.rate as Settings['video']['rate'] | { mode: 'quality'; level: string };
  if (rate.mode !== 'quality' || !('level' in rate)) return settings;
  return { ...settings, video: { ...settings.video, rate: { mode: 'quality', quality: OLD_LEVELS[rate.level] ?? 100 } } };
}

/** Presets saved before the Speed setting hold an encoder: best is Balanced, fast is Fast. */
function withSpeed(settings: Settings): Settings {
  const video = settings.video as Settings['video'] & { encoder?: 'best' | 'fast' };
  if (video.speed || !video.encoder) return settings;
  const { encoder, ...rest } = video;
  return { ...settings, video: { ...rest, speed: encoder === 'fast' ? 'fast' : 'balanced' } };
}

export async function savePresets(files: FileOps, presets: Preset[]): Promise<void> {
  await files.writeText(`${await files.configDir()}/${FILE}`, JSON.stringify({ version: 1, presets }, null, 2));
}
