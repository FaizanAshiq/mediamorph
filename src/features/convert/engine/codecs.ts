import type { Rate, Speed, VideoCodec } from './types';

export type VideoTarget = Exclude<VideoCodec, 'auto'>;

/**
 * Plain words for a slider position. Measured with VMAF (0 to 100, how close to the source it looks) on film:
 * 100 scores about 97, 70 about 93, 40 about 88.
 */
export function qualityWords(quality: number): string {
  if (quality >= 90) return 'looks the same';
  if (quality >= 75) return 'nearly the same';
  if (quality >= 55) return 'slight softening';
  if (quality >= 30) return 'visibly softer';
  return 'very soft';
}

/** CRF at the top (100) and the bottom (0) of the slider; positions between are spread evenly. */
const CRF_RANGE: Record<VideoTarget, { best: number; low: number }> = {
  h264: { best: 20, low: 40 },
  hevc: { best: 22, low: 42 },
  av1: { best: 30, low: 57 },
  vp9: { best: 31, low: 48 },
};

/** How many CRF steps halve the size, measured on film: x264 and x265 about 6, SVT-AV1 about 12, libvpx VP9 about 10. */
export const CRF_PER_HALVING: Record<VideoTarget, number> = { h264: 6, hevc: 6, av1: 12, vp9: 10 };

/** Typical bits per pixel at the top of the slider, for a first guess before anything is measured. */
const TYPICAL_BITS_PER_PIXEL: Record<VideoTarget, number> = { h264: 0.1, hevc: 0.05, av1: 0.045, vp9: 0.045 };

/**
 * Smallest file: a slower preset and a CRF offset that land at the same look as balanced but smaller. Measured at
 * matched VMAF on 60 s of a 720p 10-bit HEVC film (x265 slow at CRF +3: 20 percent smaller, VMAF 97.1 against 97.0, 2.7 times the
 * time) and 30 s of a 480p H.264 film (x264 veryslow at CRF +1: 21 percent smaller, VMAF 92.9 against 93.1, 4 times);
 * SVT-AV1 preset 4 against 6 at the same CRF was 3 percent smaller and 1.5 times the time. VP9 is not measured.
 * `size` is the size at the same CRF and `time` the encoding time, both against balanced.
 */
const SMALLEST: Record<VideoTarget, { crfOffset: number; size: number; time: number }> = {
  h264: { crfOffset: 1, size: 0.89, time: 4 },
  hevc: { crfOffset: 3, size: 1.13, time: 2.7 },
  av1: { crfOffset: 0, size: 0.97, time: 1.5 },
  vp9: { crfOffset: 0, size: 0.95, time: 1.8 },
};

export function crfFor(codec: VideoTarget, quality: number, speed: Speed = 'balanced'): number {
  const { best, low } = CRF_RANGE[codec];
  const offset = speed === 'smallest' ? SMALLEST[codec].crfOffset : 0;
  return Math.round(best + (low - best) * (1 - quality / 100)) + offset;
}

/** How a software speed compares with balanced at the same CRF: file size and encoding time, as factors. */
export function speedFactors(codec: VideoTarget, speed: Speed): { size: number; time: number } {
  return speed === 'smallest' ? { size: SMALLEST[codec].size, time: SMALLEST[codec].time } : { size: 1, time: 1 };
}

/** What Smallest file buys for a codec: how much smaller at the same look, and how many times longer it takes. */
export function smallestGain(codec: VideoTarget): { smaller: number; slower: number } {
  const { crfOffset, size, time } = SMALLEST[codec];
  return { smaller: 1 - size * 2 ** (-crfOffset / CRF_PER_HALVING[codec]), slower: time };
}

/** A first guess of the kbps a CRF encode lands on, from typical film. */
export function typicalKbps(codec: VideoTarget, crf: number, pixelsPerSec: number): number {
  return ((pixelsPerSec * TYPICAL_BITS_PER_PIXEL[codec]) / 1000) * 2 ** ((CRF_RANGE[codec].best - crf) / CRF_PER_HALVING[codec]);
}

/** VideoToolbox's -q:v runs 1 to 100, higher is better and bigger; used only when the original bitrate is unknown. */
function hardwareQuality(quality: number): number {
  return Math.round(15 + quality / 2);
}

/** Share of the original video bitrate a position may use: all of it at 100, a fifth at 0, so moving left always shrinks the video. */
function shareFor(quality: number): number {
  return 0.2 + 0.8 * (quality / 100);
}

/** Hardware encoders run at an average bitrate, so a heavy source also gets this ceiling, which looks the same for the codec. */
const HARDWARE_BITS_PER_PIXEL: Partial<Record<VideoTarget, number>> = { h264: 0.15, hevc: 0.1 };

export const SOFTWARE_ENCODER: Record<VideoTarget, string> = { h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9' };
export const HARDWARE_ENCODER: Partial<Record<VideoTarget, string>> = { h264: 'h264_videotoolbox', hevc: 'hevc_videotoolbox' };

export interface EncoderChoice {
  codec: VideoTarget;
  /** 'fast' only when the hardware encoder for the codec is really there. */
  speed: Speed;
  depth: 8 | 10;
}

/** Only these software encoders do a proper two-pass target size in ffmpeg. */
export function usesTwoPasses(choice: EncoderChoice, rate: Rate): boolean {
  return rate.mode === 'target' && choice.speed !== 'fast' && (choice.codec === 'h264' || choice.codec === 'vp9');
}

/**
 * The most a quality encode may spend, in kbps: the original video bitrate times the position's share, and for
 * hardware encoders no more than the ceiling for the output picture. Null when the original bitrate is unknown.
 */
export function qualityCapKbps(choice: EncoderChoice, quality: number, sourceKbps: number | null, pixelsPerSec: number): number | null {
  if (!sourceKbps) return null;
  const share = shareFor(quality);
  const bitsPerPixel = choice.speed === 'fast' ? HARDWARE_BITS_PER_PIXEL[choice.codec] : undefined;
  const ceiling = bitsPerPixel ? (pixelsPerSec * bitsPerPixel * share) / 1000 : Infinity;
  return Math.max(1, Math.floor(Math.min(sourceKbps * share, ceiling)));
}

/**
 * Encoder, rate and pixel format for one video encode; no filters, no pass flags. `kbps` is for target and bitrate
 * modes, `capKbps` (from qualityCapKbps) for the quality slider.
 */
export function videoEncoderArgs(choice: EncoderChoice, rate: Rate, kbps: number, capKbps: number | null = null): string[] {
  const { codec, speed, depth } = choice;
  const fast = speed === 'fast';
  const smallest = speed === 'smallest';
  const ten = depth === 10;
  const rateArgs = rateArgsFor(choice, rate, kbps, capKbps);
  if (fast && codec === 'h264') return ['-c:v', 'h264_videotoolbox', ...rateArgs, '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
  if (fast && codec === 'hevc') {
    return ['-c:v', 'hevc_videotoolbox', ...rateArgs, '-tag:v', 'hvc1', '-pix_fmt', ten ? 'p010le' : 'yuv420p', ...(ten ? ['-profile:v', 'main10'] : [])];
  }
  const pixFmt = ['-pix_fmt', ten ? 'yuv420p10le' : 'yuv420p'];
  if (codec === 'h264') {
    const preset = smallest ? 'veryslow' : rate.mode === 'quality' && rate.quality === 100 ? 'slow' : 'medium';
    return ['-c:v', 'libx264', '-preset', preset, ...rateArgs, '-profile:v', ten ? 'high10' : 'high', ...pixFmt];
  }
  if (codec === 'hevc') return ['-c:v', 'libx265', '-preset', smallest ? 'slow' : 'medium', ...rateArgs, ...pixFmt, '-tag:v', 'hvc1'];
  // Preset 6 beat 8 on both size and quality on film, and still ran faster than x265 medium.
  if (codec === 'av1') return ['-c:v', 'libsvtav1', '-preset', smallest ? '4' : '6', ...rateArgs, ...pixFmt];
  return ['-c:v', 'libvpx-vp9', ...rateArgs, '-row-mt', '1', '-deadline', 'good', '-cpu-used', smallest ? '1' : '2', ...pixFmt, ...(ten ? ['-profile:v', '2'] : [])];
}

function rateArgsFor(choice: EncoderChoice, rate: Rate, kbps: number, capKbps: number | null): string[] {
  if (rate.mode === 'quality') {
    // Hardware quality mode ignores a cap's buffer and starves busy scenes, so fast mode aims at the cap on average.
    if (choice.speed === 'fast') return capKbps ? ['-b:v', `${capKbps}k`] : ['-q:v', String(hardwareQuality(rate.quality))];
    const crf = ['-crf', String(crfFor(choice.codec, rate.quality, choice.speed))];
    // libvpx reads -b:v next to -crf as the most it may use; 0 means no limit.
    if (choice.codec === 'vp9') return [...crf, '-b:v', capKbps ? `${capKbps}k` : '0'];
    return capKbps ? [...crf, '-maxrate', `${capKbps}k`, '-bufsize', `${capKbps * 2}k`] : crf;
  }
  const bitrate = ['-b:v', `${kbps}k`];
  if (rate.mode === 'target') return bitrate;
  return [...bitrate, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`];
}
