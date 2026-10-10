import { CRF_PER_HALVING, speedFactors, typicalKbps, type VideoTarget } from './codecs';
import { guessedBitRate, sourceVideoKbps } from './planner';
import type { Child } from './ports';
import { probe } from './probe';
import type { RunDeps } from './runner';
import type { FileInfo, Plan, VideoRate } from './types';

export interface Estimate {
  bytes: number;
  /** Null until something like these settings has been timed. */
  seconds: number | null;
  /** exact: from the source's own packets. measured: sample encodes of these very settings. guess: worked out from other samples, or from typical film. */
  kind: 'exact' | 'measured' | 'guess';
  /** The video's bitrate in the output, on the same footing as `kind`; null when there is no video. */
  videoKbps: number | null;
}

/** What one packet scan and the sample encodes found. The queue keeps these per file, so most changes need no ffmpeg at all. */
export interface Measures {
  /** Bytes in each source stream. */
  packets?: Record<number, number>;
  /** Sample encodes, by the video arguments that made them. */
  samples: Record<string, VideoSample>;
}

export interface VideoSample {
  bytesPerSec: number;
  /** Seconds of video encoded per second of work. */
  speed: number;
  rate: VideoRate;
}

export interface MeasureHandle {
  result: Promise<Measures | null>;
  cancel(): void;
}

type EncodeRate = Extract<VideoRate, { codec: string }>;

const COPY_BYTES_PER_SEC = 150e6;
const SAMPLE_SEC = 10;
/** Container overhead on copied tracks. */
const COPY_OVERHEAD = 1.01;
const EXTRA_TRACK_BPS = 192000;
/** Measuring loudness reads the whole track at roughly this many times real time. */
const MEASURE_SPEED = 100;
/** Bits grow slower than pixels: half the pixels needs about 60 percent of the bits. */
const PIXEL_EXPONENT = 0.75;

/** Where to take samples: three spots through a long file, the start of a short one. */
export function sampleStarts(lengthSec: number): number[] {
  if (lengthSec < 30) return [0];
  return [0.2, 0.5, 0.8].map((f) => Math.floor(lengthSec * f));
}

export function sampleKey(plan: Plan): string | null {
  return plan.videoArgs ? plan.videoArgs.join(' ') : null;
}

/** What still has to be measured before this plan's size is exact or measured rather than guessed. */
export function missing(plan: Plan, measures: Measures): { packets: boolean; sample: boolean } {
  const key = sampleKey(plan);
  const copies = plan.tracks.some((t) => t.action === 'copy' && t.kind !== 'subtitle');
  return { packets: copies && !measures.packets, sample: key !== null && !measures.samples[key] };
}

/** The size and time of a plan from what has been measured so far, guessing whatever is missing. Null when the length is unknown. */
export function sizeFrom(info: FileInfo, plan: Plan, measures: Measures): Estimate | null {
  const lengthSec = plan.expect.durationSec || info.durationSec;
  if (!lengthSec) return null;
  let guessed = false;
  let bytes = 0;

  const kept = plan.tracks.filter((t) => t.kind !== 'subtitle' && (t.action === 'copy' || t.action === 'encode'));
  let copiedVideoBytes: number | null = null;
  for (const t of kept) {
    if (t.kind === 'video' && t.action === 'encode') continue;
    if (t.action === 'encode') {
      bytes += ((t.bitRate ?? EXTRA_TRACK_BPS) * lengthSec) / 8;
      continue;
    }
    const scanned = measures.packets?.[t.source];
    if (scanned === undefined) guessed = true;
    const trackBytes = scanned ?? (sourceBitRate(info, t.source) * lengthSec) / 8;
    if (t.kind === 'video') copiedVideoBytes = trackBytes;
    bytes += scanned !== undefined ? scanned * COPY_OVERHEAD : trackBytes;
  }
  const extraTracks = Math.max(0, plan.expect.audioTracks - kept.filter((t) => t.kind === 'audio').length);
  bytes += (extraTracks * EXTRA_TRACK_BPS * lengthSec) / 8;
  const encodesAudio = extraTracks > 0 || kept.some((t) => t.kind === 'audio' && t.action === 'encode');

  const loudness = (plan.steps.filter((s) => s.kind === 'measure-loudness').length * lengthSec) / MEASURE_SPEED;
  const rate = plan.videoRate;
  if (rate.kind === 'none' || rate.kind === 'copy') {
    return {
      bytes,
      seconds: bytes / COPY_BYTES_PER_SEC + loudness,
      kind: guessed ? 'guess' : encodesAudio ? 'measured' : 'exact',
      videoKbps: copiedVideoBytes === null ? null : (copiedVideoBytes * 8) / lengthSec / 1000,
    };
  }

  const exact = measures.samples[sampleKey(plan) ?? ''];
  const video = exact ?? guessVideo(rate, Object.values(measures.samples));
  if (!video) return null;
  const passes = plan.steps.some((s) => s.kind === 'first-pass') ? 1.8 : 1;
  return {
    bytes: bytes + video.bytesPerSec * lengthSec,
    seconds: video.speed ? (lengthSec / video.speed) * passes + loudness : null,
    kind: exact && !guessed ? 'measured' : 'guess',
    videoKbps: (video.bytesPerSec * 8) / 1000,
  };
}

/**
 * The video of an unmeasured encode, scaled from the closest sample of the same codec, or from typical film. The
 * hardware encoder and the software ones are told apart; Balanced and Smallest file scale by their measured factors.
 */
function guessVideo(rate: EncodeRate, samples: VideoSample[]): { bytesPerSec: number; speed: number } | null {
  const hardware = (r: EncodeRate) => r.speed === 'fast';
  const alike = samples
    .map((s) => ({ sample: s, rate: s.rate }))
    .filter((s): s is { sample: VideoSample; rate: EncodeRate } => 'codec' in s.rate && s.rate.codec === rate.codec && hardware(s.rate) === hardware(rate));
  const distance = (r: EncodeRate) =>
    Math.abs(Math.log(r.pixelsPerSec / rate.pixelsPerSec)) + (r.speed === rate.speed ? 0 : 0.5) + (r.kind === 'crf' && rate.kind === 'crf' ? Math.abs(r.crf - rate.crf) / 100 : 0);
  const nearest = alike.sort((a, b) => distance(a.rate) - distance(b.rate))[0];
  const pixels = nearest ? rate.pixelsPerSec / nearest.rate.pixelsPerSec : 1;
  const codec = rate.codec as VideoTarget;
  const from = nearest ? speedFactors(codec, nearest.rate.speed) : { size: 1, time: 1 };
  const to = speedFactors(codec, rate.speed);
  // More pixels take longer to encode, in step with their number; a slower preset takes its measured factor longer.
  const speed = nearest ? (nearest.sample.speed / pixels) * (from.time / to.time) : 0;

  if (rate.kind === 'average') return { bytesPerSec: (rate.kbps * 1000) / 8, speed };
  if (!nearest) {
    if (rate.kind !== 'crf') return null;
    return { bytesPerSec: (capped(typicalKbps(rate.codec as VideoTarget, rate.crf, rate.pixelsPerSec), rate.capKbps) * 1000) / 8, speed };
  }
  let kbps = kbpsOf(nearest.sample) * pixels ** PIXEL_EXPONENT * (to.size / from.size);
  if (rate.kind === 'crf' && nearest.rate.kind === 'crf') {
    const sameSpeed = alike.map((s) => s.sample).filter((s) => s.rate.kind !== 'none' && s.rate.kind !== 'copy' && s.rate.speed === rate.speed);
    const slope = learnedSlope(sameSpeed, rate) ?? CRF_PER_HALVING[codec];
    kbps *= 2 ** ((nearest.rate.crf - rate.crf) / slope);
  }
  return { bytesPerSec: (capped(kbps, rate.kind === 'crf' ? rate.capKbps : null) * 1000) / 8, speed };
}

/**
 * How many CRF steps halve this very file, from two samples of the same picture at different CRF. Grainy video
 * shrinks far faster than clean film, so a file's own slope beats the typical one once there are two samples.
 * Samples held down by the cap say nothing about CRF, so they are left out.
 */
function learnedSlope(samples: VideoSample[], rate: Extract<VideoRate, { kind: 'crf' }>): number | null {
  const free = samples
    .map((s) => ({ kbps: kbpsOf(s), rate: s.rate }))
    .filter((s): s is { kbps: number; rate: Extract<VideoRate, { kind: 'crf' }> } => s.rate.kind === 'crf')
    .filter((s) => Math.abs(s.rate.pixelsPerSec / rate.pixelsPerSec - 1) < 0.01 && (!s.rate.capKbps || s.kbps < s.rate.capKbps * 0.85))
    .sort((a, b) => Math.abs(a.rate.crf - rate.crf) - Math.abs(b.rate.crf - rate.crf));
  const [a, b] = free;
  if (!a || !b || a.rate.crf === b.rate.crf || a.kbps === b.kbps) return null;
  const slope = (b.rate.crf - a.rate.crf) / Math.log2(a.kbps / b.kbps);
  return slope > 0 ? Math.min(Math.max(slope, 2), 24) : null;
}

function kbpsOf(sample: VideoSample): number {
  return (sample.bytesPerSec * 8) / 1000;
}

function capped(kbps: number, cap: number | null): number {
  return cap ? Math.min(kbps, cap) : kbps;
}

/** Bits per second of a source stream, from the file or a fair guess. */
function sourceBitRate(info: FileInfo, index: number): number {
  const audio = info.audio.find((a) => a.index === index);
  if (audio) return audio.bitRate ?? guessedBitRate(audio.channels);
  if (info.video?.index === index) return (sourceVideoKbps(info, info.video) ?? 0) * 1000;
  return 0;
}

/** Measures what `need` asks for: one packet scan of the source, and three 10 s sample encodes of the plan's video. */
export function measure(info: FileInfo, plan: Plan, need: { packets: boolean; sample: boolean }, deps: RunDeps): MeasureHandle {
  let cancelled = false;
  let child: Child | null = null;
  const lengthSec = plan.expect.durationSec || info.durationSec;

  const packets = async (): Promise<Record<number, number> | null> => {
    const out = await deps.spawner.run('ffprobe', ['-v', 'error', '-show_entries', 'packet=stream_index,size', '-of', 'csv=p=0', info.path]);
    if (cancelled || out.code !== 0) return null;
    const bytes: Record<number, number> = {};
    for (const line of out.stdout.split('\n')) {
      const [stream, size] = line.split(',').map(Number);
      if (Number.isFinite(stream) && Number.isFinite(size)) bytes[stream] = (bytes[stream] ?? 0) + size;
    }
    return bytes;
  };

  const sample = async (videoArgs: string[]): Promise<VideoSample | null> => {
    const cache = await deps.files.cacheDir();
    let bytes = 0;
    let seconds = 0;
    let wall = 0;
    for (const [i, start] of sampleStarts(lengthSec).entries()) {
      if (cancelled) return null;
      const out = `${cache}/estimate-${i}.mkv`;
      const began = Date.now();
      child = await deps.spawner.spawn(
        'ffmpeg',
        ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(start), '-i', info.path, '-t', String(SAMPLE_SEC), ...videoArgs.map((a) => a.split('{cache}').join(cache)), '-an', '-sn', out],
        { stdout: () => {}, stderr: () => {} },
      );
      if (cancelled) await child.kill();
      const { code } = await child.done;
      if (cancelled || code !== 0) return null;
      wall += (Date.now() - began) / 1000;
      const made = await probe(deps.spawner, out);
      bytes += made.sizeBytes;
      seconds += made.durationSec || Math.min(SAMPLE_SEC, lengthSec - start);
    }
    if (!seconds || !wall) return null;
    return { bytesPerSec: bytes / seconds, speed: seconds / wall, rate: plan.videoRate };
  };

  const run = async (): Promise<Measures | null> => {
    const found: Measures = { samples: {} };
    if (need.packets) found.packets = (await packets()) ?? undefined;
    const key = sampleKey(plan);
    if (need.sample && key && plan.videoArgs) {
      const made = await sample(plan.videoArgs);
      if (made) found.samples[key] = made;
    }
    return cancelled ? null : found;
  };

  const result = run().catch(() => null);
  return {
    result,
    cancel: () => {
      cancelled = true;
      void child?.kill();
    },
  };
}
