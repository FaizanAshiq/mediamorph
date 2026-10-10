import type { Loudness } from './types';

export const AAC_LAYOUTS = 'mono|stereo|3.0|4.0|5.0|5.1|7.1';

export const LOUDNESS_TARGETS: Record<Exclude<Loudness, 'off'>, { i: number; tp: number; label: string; words: string }> = {
  streaming: { i: -14, tp: -1, label: 'Streaming (-14 LUFS)', words: 'set to -14 LUFS for streaming' },
  'eu-tv': { i: -23, tp: -1, label: 'EU TV (-23 LUFS)', words: 'set to -23 LUFS for EU TV' },
  'us-tv': { i: -24, tp: -2, label: 'US TV (-24 LKFS)', words: 'set to -24 LKFS for US TV' },
};

export interface Measured {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export function measureFilter(loudness: Exclude<Loudness, 'off'>): string {
  const t = LOUDNESS_TARGETS[loudness];
  return `loudnorm=I=${t.i}:TP=${t.tp}:LRA=11:print_format=json`;
}

/** loudnorm prints its measurement as the last JSON block in ffmpeg's log. */
export function parseLoudnorm(lines: string[]): Measured | null {
  const text = lines.join('\n');
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const json = JSON.parse(text.slice(start, end + 1)) as Partial<Measured>;
    const keys: (keyof Measured)[] = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
    return keys.every((key) => typeof json[key] === 'string') ? (json as Measured) : null;
  } catch {
    return null;
  }
}

/** The second loudnorm pass, fed the first pass's measurement; `stereo` downmixes first, as it was measured. */
export function secondPassFilter(loudness: Exclude<Loudness, 'off'>, m: Measured, stereo: boolean): string {
  const t = LOUDNESS_TARGETS[loudness];
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const downmix = stereo ? 'aformat=channel_layouts=stereo,' : '';
  // loudnorm works at 192 kHz inside, so resample back to 48 kHz for the encoder.
  return `${downmix}loudnorm=I=${t.i}:TP=${t.tp}:LRA=11:${measured}:linear=true,aresample=48000,aformat=channel_layouts=${AAC_LAYOUTS}`;
}
