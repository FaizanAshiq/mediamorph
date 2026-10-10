import { crfFor, HARDWARE_ENCODER, qualityCapKbps, qualityWords, usesTwoPasses, videoEncoderArgs, type EncoderChoice, type VideoTarget } from './codecs';
import { videoFilterArgs, type Burn } from './filters';
import { FORMATS, holds, type FormatRules } from './formats';
import { AAC_LAYOUTS, LOUDNESS_TARGETS, measureFilter } from './loudness';
import { shortHash } from './naming';
import { displaySize, evenFloor, fitInBox } from './sizes';
import {
  FULL_MACHINE,
  type AudioTrack,
  type FileInfo,
  type Machine,
  type Plan,
  type Settings,
  type Step,
  type SubtitleTrack,
  type TrackPlan,
  type VideoRate,
  type VideoTrack,
} from './types';
import { codecName, describeAudio, formatBytes, joinWords, languageName } from './words';


/** Single pictures: JPEG shows up as image2, the rest as <codec>_pipe. Animated GIF is its own format and still converts. */
const PICTURE_FORMATS = /^image2$|_pipe$/;
const OPUS_LAYOUTS = 'mono|stereo|5.1|7.1';
const MIN_VIDEO_KBPS = 100;
/** Share of a target size given to tracks; the rest covers the container. */
const TARGET_SHARE = 0.98;

export class PlanError extends Error {}

interface Part {
  args: string[];
  tracks: TrackPlan[];
  summary: string[];
  warnings: string[];
}

interface VideoPart extends Part {
  size: { width: number; height: number };
  encoded: boolean;
  firstPass: string[] | null;
  alone: string[] | null;
  rate: VideoRate;
}

/** Everything the parts need to agree on. */
interface Context {
  info: FileInfo;
  settings: Settings;
  format: FormatRules;
  machine: Machine;
  audio: AudioTrack[];
  first: AudioTrack | null;
  stereoFrom: AudioTrack | null;
  lengthSec: number;
}

export function plan(info: FileInfo, settings: Settings, machine: Machine = FULL_MACHINE): Plan {
  if (!info.video && info.audio.length === 0) throw new PlanError('This file has no video or sound to convert');
  if (PICTURE_FORMATS.test(info.container)) throw new PlanError('This is a picture, not a video.');

  const format = FORMATS[settings.format];
  const audio = settings.audio.keep === 'all' ? info.audio : info.audio.filter((a) => (settings.audio.keep as number[]).includes(a.index));
  const first = audio.find((a) => a.index === settings.audio.first) ?? audio[0] ?? null;
  const stereoFrom = settings.audio.addStereo && !format.audioOnly ? (audio.find((a) => a.channels >= 6) ?? null) : null;
  const ctx: Context = { info, settings, format, machine, audio, first, stereoFrom, lengthSec: keptLength(info) };

  if (format.audioOnly) return planAudioOnly(ctx);

  const subtitles = planSubtitles(ctx);
  const video = info.video ? planVideo(ctx, info.video, subtitles.burn) : null;
  const sound = planAudio(ctx);
  const parts: Part[] = [...(video ? [video] : []), sound, subtitles];

  const summary = parts.flatMap((p) => p.summary);
  if (info.chapters) summary.push(`Chapters: ${info.chapters} kept`);
  const warnings = parts.flatMap((p) => p.warnings);
  if (!info.durationSec) warnings.push('This file does not say how long it is, so progress and the length check are skipped.');

  const input = ['-i', info.path];
  const output = [
    ...parts.flatMap((p) => p.args),
    ...(format.faststart ? ['-movflags', '+faststart'] : []),
    '-max_muxing_queue_size',
    '4096',
  ];
  const steps: Step[] = [
    ...loudnessSteps(ctx),
    ...(video?.firstPass ? [{ kind: 'first-pass' as const, input, output: video.firstPass, to: 'null' as const }] : []),
    { kind: 'encode', input, output, to: 'temp' },
    ...srtSteps(ctx),
  ];

  return {
    ext: format.ext,
    tracks: parts.flatMap((p) => p.tracks),
    steps,
    summary,
    warnings,
    expect: {
      durationSec: ctx.lengthSec,
      audioTracks: audio.length + (stereoFrom ? 1 : 0),
      subtitleTracks: subtitles.kept,
      video: video?.size ?? null,
    },
    minFreeBytes: video && !video.encoded ? info.sizeBytes : null,
    videoArgs: video?.alone ?? null,
    videoRate: video?.rate ?? { kind: 'none' },
    loudness: settings.audio.loudness,
    trashOriginal: settings.trashOriginal,
  };
}

/**
 * The output is as long as its longest kept track; a dropped subtitle can make the source look longer. Never longer
 * than the file itself: a clip cut from a film with -c copy keeps the whole film's track lengths in its tags.
 */
function keptLength(info: FileInfo): number {
  const lengths = [info.video?.durationSec, ...info.audio.map((a) => a.durationSec)].filter((d): d is number => !!d);
  const longest = lengths.length ? Math.max(...lengths) : info.durationSec;
  return info.durationSec ? Math.min(longest, info.durationSec) : longest;
}

// Video

function planVideo(ctx: Context, v: VideoTrack, burn: Burn | null): VideoPart {
  const { settings, format, machine } = ctx;
  // Sizes follow the picture as shown. A copy keeps the stored size and its rotation tag;
  // a re-encode turns the picture upright, so its output is stored at the shown size.
  const shown = displaySize(v);
  const fit = fitInBox(shown.width, shown.height, settings.size);
  const fps = typeof settings.fps === 'number' && settings.fps < v.fps - 0.01 ? settings.fps : null;
  const rate = settings.video.rate;
  const reason = encodeReason(ctx, v, { fit: fit !== null, fps: fps !== null, burn: burn !== null });

  if (!reason) {
    const tag = v.codec === 'hevc' && format.faststart ? ['-tag:v', 'hvc1'] : [];
    return {
      args: ['-map', `0:${v.index}`, '-c:v', 'copy', ...tag],
      tracks: [{ source: v.index, kind: 'video', action: 'copy', why: `${format.label} holds ${codecName(v.codec)} as it is` }],
      summary: ['Video: copied, no quality loss'],
      warnings: [],
      size: { width: v.width, height: v.height },
      encoded: false,
      firstPass: null,
      alone: null,
      rate: { kind: 'copy' },
    };
  }

  const warnings: string[] = [];
  const codec = targetCodec(ctx, v);
  const depth = settings.video.bitDepth === 'same' ? (v.bitDepth >= 10 && codec !== 'h264' ? 10 : 8) : settings.video.bitDepth;
  const wanted = settings.video.speed;
  const choice: EncoderChoice = { codec, depth, speed: wanted === 'fast' ? 'balanced' : wanted };
  if (wanted === 'fast') {
    const hardware = HARDWARE_ENCODER[codec];
    if (!hardware) warnings.push(`Fast is not available for ${codecName(codec)}, so Balanced is used.`);
    else if (!machine.encoders.has(hardware)) warnings.push('Fast is not available on this computer, so Balanced is used.');
    else if (codec === 'h264' && depth === 10) warnings.push('Fast cannot make 10-bit H.264, so Balanced is used.');
    else choice.speed = 'fast';
  }

  const size = fit ?? { width: evenFloor(shown.width), height: evenFloor(shown.height) };
  const scaled = size.width !== shown.width || size.height !== shown.height;
  const filters = videoFilterArgs({ video: v.index, fps, scale: scaled ? size : null, burn });
  const kbps = rate.mode === 'target' ? targetKbps(ctx, rate.bytes) : rate.mode === 'bitrate' ? rate.kbps : 0;
  const pixelsPerSec = size.width * size.height * (fps ?? v.fps);
  const cap = rate.mode === 'quality' ? qualityCapKbps(choice, rate.quality, sourceVideoKbps(ctx.info, v), pixelsPerSec) : null;
  const encoder = [...videoEncoderArgs(choice, rate, kbps, cap), ...hdrArgs(v, choice, warnings)];

  let firstPass: string[] | null = null;
  const passes: string[] = [];
  if (usesTwoPasses(choice, rate)) {
    const log = ['-passlogfile', `{cache}/pass-${shortHash(ctx.info.path)}`];
    firstPass = [...filters, ...encoder, '-pass', '1', ...log, '-an', '-sn'];
    passes.push('-pass', '2', ...log);
  }

  const changes = [fit ? `shrunk to ${size.width}x${size.height}` : null, fps ? `${v.fps} fps to ${fps} fps` : null].filter(Boolean);
  const as = codec === 'h264' && settings.video.codec === 'auto' && format.videoCodecs[0] === 'h264' ? '' : ` as ${codecName(codec)}`;
  const levelWords = rate.mode === 'quality' ? `${qualityWords(rate.quality)}${cap && rate.quality === 100 ? ', no bigger than the original' : ''}` : '';
  const rateWords = rate.mode === 'quality' ? levelWords : rate.mode === 'target' ? `aiming for ${formatBytes(rate.bytes)}` : `${rate.kbps} kbps`;
  return {
    args: [...filters, ...encoder, ...passes],
    tracks: [{ source: v.index, kind: 'video', action: 'encode', why: reason }],
    summary: [`Video: ${changes.map((c) => `${c}, `).join('')}re-encoded${as}${SPEED_WORDS[choice.speed]}, ${rateWords}`],
    warnings,
    size,
    encoded: true,
    firstPass,
    alone: [...filters, ...encoder],
    rate: videoRate(choice, rate, pixelsPerSec, kbps, cap),
  };
}

function encodeReason(ctx: Context, v: VideoTrack, forced: { fit: boolean; fps: boolean; burn: boolean }): string | null {
  const { settings, format } = ctx;
  const wanted = settings.video.codec;
  const sourceDepth = v.bitDepth >= 10 ? 10 : 8;
  if (!holds(format.videoCopy, v.codec)) return `${format.label} cannot hold ${codecName(v.codec)}`;
  if (forced.burn) return 'Burning subtitles in needs a re-encode';
  if (forced.fit) return 'Shrinking the picture needs a re-encode';
  if (forced.fps) return 'Changing the frame rate needs a re-encode';
  if (wanted !== 'auto' && wanted !== v.codec) return `Changing to ${codecName(wanted)} needs a re-encode`;
  if (settings.video.bitDepth !== 'same' && settings.video.bitDepth !== sourceDepth) return 'Changing the colour depth needs a re-encode';
  if (settings.video.rate.mode === 'target') return 'Aiming for a size needs a re-encode';
  if (settings.video.rate.mode === 'bitrate') return 'A fixed bitrate needs a re-encode';
  if (settings.video.rate.quality < 100) return 'Making the file smaller needs a re-encode';
  return null;
}

const SPEED_WORDS: Record<EncoderChoice['speed'], string> = { fast: ' (fast)', balanced: '', smallest: ' (slow, smallest file)' };

/** What decides the video's size, for sizes worked out without encoding. */
function videoRate(choice: EncoderChoice, rate: Settings['video']['rate'], pixelsPerSec: number, kbps: number, cap: number | null): VideoRate {
  const base = { codec: choice.codec, speed: choice.speed, pixelsPerSec };
  if (rate.mode !== 'quality') return { kind: 'average', ...base, kbps };
  if (choice.speed === 'fast') return cap ? { kind: 'average', ...base, kbps: cap } : { kind: 'unknown', ...base };
  return { kind: 'crf', ...base, crf: crfFor(choice.codec, rate.quality, choice.speed), capKbps: cap };
}

function targetCodec(ctx: Context, v: VideoTrack): VideoTarget {
  return encodeCodec(ctx.settings, ctx.format, v);
}

/**
 * The codec a re-encode uses: an explicit choice the format allows, else the original codec when the format can make
 * it (an HEVC movie re-encoded as H.264 comes out about twice the size), else HEVC for HDR sources (keeps HDR),
 * else the format's usual codec.
 */
export function encodeCodec(settings: Settings, format: FormatRules, v: VideoTrack): VideoTarget {
  const wanted = settings.video.codec;
  if (wanted !== 'auto' && format.videoCodecs.includes(wanted)) return wanted;
  const same = format.videoCodecs.find((c) => c === v.codec);
  if (same) return same;
  if (v.hdr !== 'sdr' && format.videoCodecs.includes('hevc')) return 'hevc';
  return format.videoCodecs[0];
}

/** The original video bitrate in kbps: from the file, else the whole file's rate less its audio. Null when unknown. */
export function sourceVideoKbps(info: FileInfo, v: VideoTrack): number | null {
  if (v.bitRate) return v.bitRate / 1000;
  if (!info.durationSec || !info.sizeBytes) return null;
  const audio = info.audio.reduce((sum, a) => sum + (a.bitRate ?? guessedBitRate(a.channels)), 0);
  const kbps = ((info.sizeBytes * 8) / info.durationSec - audio) / 1000;
  return kbps > 0 ? kbps : null;
}

function hdrArgs(v: VideoTrack, choice: EncoderChoice, warnings: string[]): string[] {
  if (v.hdr === 'sdr') return [];
  if (choice.codec === 'h264') {
    warnings.push('This video is HDR. Re-encoding it to standard H.264 makes the colours look washed out.');
    return [];
  }
  if (choice.depth !== 10) {
    warnings.push('This video is HDR. Re-encoding it to 8-bit makes the colours look washed out.');
    return [];
  }
  const transfer = v.hdr === 'hdr10' ? 'smpte2084' : 'arib-std-b67';
  const colour = ['-color_primaries', 'bt2020', '-color_trc', transfer, '-colorspace', 'bt2020nc'];
  if (choice.codec !== 'hevc' || choice.speed === 'fast') return colour;
  const params = [
    ...(v.hdr === 'hdr10' ? ['hdr10=1'] : []),
    'repeat-headers=1',
    'colorprim=bt2020',
    `transfer=${transfer}`,
    'colormatrix=bt2020nc',
    ...(v.hdrMeta?.masterDisplay ? [`master-display=${v.hdrMeta.masterDisplay}`] : []),
    ...(v.hdrMeta?.maxCll ? [`max-cll=${v.hdrMeta.maxCll}`] : []),
  ];
  return [...colour, '-x265-params', params.join(':')];
}

/** Video bitrate that lands the whole file on `bytes`, after the audio's share. */
function targetKbps(ctx: Context, bytes: number): number {
  const length = ctx.lengthSec;
  if (!length) throw new PlanError('This file does not say how long it is, so a target size cannot be worked out.');
  const audioBits = audioBitsPerSecond(ctx) * length;
  const kbps = Math.floor((bytes * 8 * TARGET_SHARE - audioBits) / length / 1000);
  if (kbps >= MIN_VIDEO_KBPS) return kbps;
  const smallest = Math.ceil((MIN_VIDEO_KBPS * 1000 * length + audioBits) / 8 / TARGET_SHARE);
  throw new PlanError(`That size is too small for this length. It needs at least ${formatBytes(smallest)}.`);
}

function audioBitsPerSecond(ctx: Context): number {
  const perTrack = ctx.audio.map((a) => (copiesAudio(ctx, a) ? (a.bitRate ?? guessedBitRate(a.channels)) : parseInt(audioBitrate(ctx.format, a.channels), 10) * 1000));
  return perTrack.reduce((sum, bits) => sum + bits, 0) + (ctx.stereoFrom ? 192000 : 0);
}

// Audio

/** Files made by ffmpeg often leave out the audio bitrate; typical AAC runs near 64 kbps per channel. */
export function guessedBitRate(channels: number): number {
  return 64000 * Math.max(1, channels);
}

function copiesAudio(ctx: Context, a: AudioTrack): boolean {
  return ctx.settings.audio.loudness === 'off' && holds(ctx.format.audioCopy, a.codec);
}

function audioBitrate(format: FormatRules, channels: number): string {
  if (format.audioEncoder === 'libopus') return channels <= 2 ? '128k' : `${48 * channels}k`;
  if (channels === 1) return '96k';
  if (channels === 2) return '192k';
  return `${64 * channels}k`;
}

function encodedAudioArgs(ctx: Context, a: AudioTrack, out: number): string[] {
  const { format, settings } = ctx;
  const loud = settings.audio.loudness !== 'off';
  if (format.audioEncoder === 'libmp3lame') {
    return [`-c:a:${out}`, 'libmp3lame', '-q:a', '2', ...(loud ? [`-filter:a:${out}`, `{loudnorm:${a.index}}`] : [])];
  }
  const layouts = format.audioEncoder === 'libopus' ? OPUS_LAYOUTS : AAC_LAYOUTS;
  const filter = loud ? `{loudnorm:${a.index}}` : `aformat=channel_layouts=${layouts}`;
  return [`-c:a:${out}`, format.audioEncoder, `-b:a:${out}`, audioBitrate(format, a.channels), `-filter:a:${out}`, filter];
}

function planAudio(ctx: Context): Part {
  const { info, format, settings, audio, first, stereoFrom } = ctx;
  const part: Part = { args: [], tracks: [], summary: [], warnings: [] };
  const copied: string[] = [];
  const converted: string[] = [];

  audio.forEach((a, i) => {
    part.args.push('-map', `0:${a.index}`);
    if (copiesAudio(ctx, a)) {
      part.args.push(`-c:a:${i}`, 'copy');
      part.tracks.push({ source: a.index, kind: 'audio', action: 'copy', why: `${format.label} holds ${codecName(a.codec)} as it is` });
      copied.push(describeAudio(a));
      return;
    }
    part.args.push(...encodedAudioArgs(ctx, a, i));
    const why = settings.audio.loudness !== 'off' ? 'Setting loudness needs a re-encode' : `${format.label} cannot hold ${codecName(a.codec)}`;
    part.tracks.push({ source: a.index, kind: 'audio', action: 'encode', why, bitRate: encodedBitRate(format, a.channels) });
    converted.push(describeAudio(a));
  });

  const total = audio.length + (stereoFrom ? 1 : 0);
  if (stereoFrom) {
    const k = audio.length;
    const bitrate = format.audioEncoder === 'libopus' ? '128k' : '192k';
    const loud = settings.audio.loudness !== 'off';
    part.args.push('-map', `0:${stereoFrom.index}`, `-c:a:${k}`, format.audioEncoder, `-b:a:${k}`, bitrate);
    part.args.push(...(loud ? [`-filter:a:${k}`, `{loudnorm:${stereoFrom.index}:stereo}`] : [`-ac:a:${k}`, '2']));
    part.args.push(`-metadata:s:a:${k}`, 'title=Stereo');
  }
  if (total >= 2) {
    audio.forEach((a, i) => part.args.push(`-disposition:a:${i}`, a === first ? 'default' : '0'));
    if (stereoFrom) part.args.push(`-disposition:a:${audio.length}`, '0');
  }

  const words: string[] = [];
  if (settings.audio.loudness !== 'off') {
    words.push(`${joinWords(audio.map(describeAudio))} ${LOUDNESS_TARGETS[settings.audio.loudness].words}`);
  } else {
    if (copied.length) words.push(`${joinWords(copied)} copied`);
    if (converted.length) words.push(`${joinWords(converted)} converted to ${encoderName(format)}`);
  }
  if (first && audio.length > 1 && first !== audio[0]) words.push(`${describeAudio(first)} plays first`);
  let line = words.length ? `Audio: ${words.join(', ')}` : info.audio.length ? 'Audio: left out' : 'Audio: none in this file';
  if (stereoFrom) line += `; stereo track added from ${describeAudio(stereoFrom)}`;
  part.summary.push(line);
  return part;
}

/** MP3 runs at -q:a 2, which lands near 190 kbps. */
function encodedBitRate(format: FormatRules, channels: number): number {
  return format.audioEncoder === 'libmp3lame' ? 190000 : parseInt(audioBitrate(format, channels), 10) * 1000;
}

function encoderName(format: FormatRules): string {
  return format.audioEncoder === 'libopus' ? 'Opus' : format.audioEncoder === 'libmp3lame' ? 'MP3' : 'AAC';
}

function loudnessSteps(ctx: Context): Step[] {
  const loudness = ctx.settings.audio.loudness;
  if (loudness === 'off') return [];
  const input = ['-i', ctx.info.path];
  const measure = (a: AudioTrack, stereo: boolean): Step => ({
    kind: 'measure-loudness',
    input,
    output: ['-map', `0:${a.index}`, '-vn', '-sn', ...(stereo ? ['-ac', '2'] : []), '-af', measureFilter(loudness)],
    to: 'null',
    audio: stereo ? `${a.index}:stereo` : String(a.index),
  });
  const tracks = ctx.format.audioOnly ? (ctx.first ? [ctx.first] : []) : ctx.audio;
  return [...tracks.map((a) => measure(a, false)), ...(ctx.stereoFrom ? [measure(ctx.stereoFrom, true)] : [])];
}

function planAudioOnly(ctx: Context): Plan {
  const { info, format, first } = ctx;
  if (!first) throw new PlanError('This file has no sound to save as audio only.');
  const copy = copiesAudio(ctx, first);
  const codec = copy ? ['-c:a:0', 'copy'] : encodedAudioArgs(ctx, first, 0);
  const how = ctx.settings.audio.loudness !== 'off' ? LOUDNESS_TARGETS[ctx.settings.audio.loudness].words : copy ? 'copied' : `converted to ${encoderName(format)}`;
  const why = copy ? `${format.label} holds ${codecName(first.codec)} as it is` : `${format.label} cannot hold ${codecName(first.codec)}`;
  return {
    ext: format.ext,
    tracks: [{ source: first.index, kind: 'audio', action: copy ? 'copy' : 'encode', why, ...(copy ? {} : { bitRate: encodedBitRate(format, first.channels) }) }],
    steps: [
      ...loudnessSteps(ctx),
      {
        kind: 'encode',
        input: ['-i', info.path],
        output: ['-vn', '-sn', '-map', `0:${first.index}`, ...codec, ...(format.faststart ? ['-movflags', '+faststart'] : [])],
        to: 'temp',
      },
    ],
    summary: ['Video: left out (audio only)', `Audio: ${describeAudio(first)} ${how}`],
    warnings: [],
    expect: { durationSec: Math.min(first.durationSec || info.durationSec, info.durationSec || Infinity), audioTracks: 1, subtitleTracks: 0, video: null },
    minFreeBytes: null,
    videoArgs: null,
    videoRate: { kind: 'none' },
    loudness: ctx.settings.audio.loudness,
    trashOriginal: ctx.settings.trashOriginal,
  };
}

// Subtitles

interface SubtitlePart extends Part {
  burn: Burn | null;
  kept: number;
}

function tickedSubtitles(ctx: Context): SubtitleTrack[] {
  const keep = ctx.settings.subtitles.keep;
  return keep === 'auto' ? ctx.info.subtitles : ctx.info.subtitles.filter((s) => keep.includes(s.index));
}

function planSubtitles(ctx: Context): SubtitlePart {
  const { info, settings, format, machine } = ctx;
  const ticked = tickedSubtitles(ctx);
  const burned = info.subtitles.find((s) => s.index === settings.subtitles.burn) ?? null;
  const part: SubtitlePart = { args: [], tracks: [], summary: [], warnings: [], burn: null, kept: 0 };

  if (burned && info.video) {
    if (burned.kind === 'text' && !machine.filters.has('subtitles')) {
      throw new PlanError('Burning text subtitles needs ffmpeg-full. Install it with: brew install ffmpeg-full');
    }
    part.burn =
      burned.kind === 'image'
        ? { kind: 'image', subtitle: burned.index, canvasWidth: info.video.width }
        : { kind: 'text', path: info.path, si: info.subtitles.indexOf(burned) };
    part.tracks.push({ source: burned.index, kind: 'subtitle', action: 'burn', why: 'Drawn onto the picture' });
  }

  const kept: SubtitleTrack[] = [];
  const noRoom: SubtitleTrack[] = [];
  for (const s of info.subtitles) {
    if (s === burned) continue;
    if (!ticked.includes(s)) {
      part.tracks.push({ source: s.index, kind: 'subtitle', action: 'drop', why: 'Not ticked' });
      continue;
    }
    const target =
      s.kind === 'image' ? (format.imageSubtitles ? 'copy' : null) : format.textSubtitles === 'copy' && s.codec === 'mov_text' ? 'srt' : format.textSubtitles;
    if (!target) {
      noRoom.push(s);
      part.tracks.push({ source: s.index, kind: 'subtitle', action: 'drop', why: `${format.label} cannot hold ${s.kind} subtitles` });
      continue;
    }
    const j = kept.length;
    part.args.push('-map', `0:${s.index}`, `-c:s:${j}`, target, `-disposition:s:${j}`, '0');
    part.tracks.push({ source: s.index, kind: 'subtitle', action: 'copy', why: `Kept inside the ${format.label}` });
    kept.push(s);
  }
  part.kept = kept.length;

  const clauses: string[] = [];
  if (part.burn && burned) clauses.push(`${languageName(burned.language)} burned into the picture`);
  if (kept.length) {
    const names = kept.map((s) => languageName(s.language));
    const who = new Set(names).size === names.length ? joinWords(names) : `${names.length} tracks`;
    const srt = settings.subtitles.saveSrt && kept.some((s) => s.kind === 'text') ? ', also saved as .srt' : '';
    clauses.push(`${who} kept inside the ${format.label}${srt}`);
  }
  const unticked = info.subtitles.filter((s) => s !== burned && !ticked.includes(s)).length;
  if (unticked) clauses.push(`${unticked} ${unticked === 1 ? 'track' : 'tracks'} left out`);
  if (noRoom.length) {
    const kind = noRoom.every((s) => s.kind === 'image') ? 'image ' : '';
    const one = noRoom.length === 1;
    clauses.push(
      `${noRoom.length} ${kind}${one ? 'track' : 'tracks'} left out: ${format.label} cannot hold ${one ? 'it' : 'them'} (burn ${one ? 'it' : 'them'} in or choose MKV)`,
    );
  }
  if (clauses.length) part.summary.push(`Subtitles: ${clauses.join('; ')}`);
  return part;
}

function srtSteps(ctx: Context): Step[] {
  if (!ctx.settings.subtitles.saveSrt) return [];
  return tickedSubtitles(ctx)
    .filter((s) => s.kind === 'text' && s.index !== ctx.settings.subtitles.burn)
    .map((s) => ({ kind: 'export-srt', input: ['-i', ctx.info.path], output: ['-map', `0:${s.index}`, '-c:s', 'srt'], to: { srt: s.index, language: s.language } }));
}
