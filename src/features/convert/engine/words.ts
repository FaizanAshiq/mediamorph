import type { AudioTrack } from './types';

const languages = new Intl.DisplayNames(['en'], { type: 'language' });

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  mpeg4: 'MPEG-4',
  vp8: 'VP8',
  vp9: 'VP9',
  aac: 'AAC',
  mp3: 'MP3',
  ac3: 'AC3',
  eac3: 'E-AC3',
  alac: 'ALAC',
  flac: 'FLAC',
  dts: 'DTS',
  truehd: 'TrueHD',
  opus: 'Opus',
  vorbis: 'Vorbis',
};

export function languageName(code: string): string {
  // Intl calls 'und' "root", which means nothing to a person.
  if (code === 'und') return 'Unknown language';
  try {
    const name = languages.of(code);
    return name && name !== code ? name : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function layoutName(channels: number): string {
  if (channels === 1) return 'mono';
  if (channels === 2) return 'stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels} channel`;
}

export function codecName(codec: string): string {
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

export function describeAudio(track: AudioTrack): string {
  return `${languageName(track.language)} ${layoutName(track.channels)}`;
}

export function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Decimal units, the way Finder counts, so the numbers match what the person sees there. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1e6;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return 'under a minute';
  const minutes = Math.round(sec / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
