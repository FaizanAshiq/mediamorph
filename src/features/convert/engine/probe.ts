import type { Spawner } from './ports';
import type { AudioTrack, FileInfo, Hdr, SubtitleTrack, VideoTrack } from './types';

export const PROBE_ARGS = ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json'];

const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);

interface RawStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
  side_data_list?: { rotation?: number }[];
  tags?: { language?: string; rotate?: string; [key: string]: string | undefined };
}

export interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; size?: string; format_name?: string };
  chapters?: unknown[];
}

export class ProbeError extends Error {}

export async function probe(spawner: Spawner, path: string): Promise<FileInfo> {
  const out = await spawner.run('ffprobe', [...PROBE_ARGS, path]);
  if (out.code !== 0) throw new ProbeError(lastLine(out.stderr) ?? 'ffprobe could not read this file');
  const info = parseProbe(path, JSON.parse(out.stdout) as RawProbe);
  if (!info.video || info.video.hdr === 'sdr') return info;
  // HDR10 mastering data lives on the frames, so read the first one.
  const frames = await spawner.run('ffprobe', ['-v', 'error', '-select_streams', `${info.video.index}`, '-read_intervals', '%+#1', '-show_frames', '-show_entries', 'frame=side_data_list', '-of', 'json', path]);
  const sideData = frames.code === 0 ? ((JSON.parse(frames.stdout) as { frames?: { side_data_list?: SideData[] }[] }).frames?.[0]?.side_data_list ?? []) : [];
  const hdrMeta = hdrMetaFrom(sideData);
  return Object.keys(hdrMeta).length ? { ...info, video: { ...info.video, hdrMeta } } : info;
}

type SideData = Record<string, string | number | undefined>;

/** x265 wants chromaticity in 1/50000 and luminance in 1/10000 steps, as integers. */
export function hdrMetaFrom(sideData: SideData[]): { masterDisplay?: string; maxCll?: string } {
  const meta: { masterDisplay?: string; maxCll?: string } = {};
  const md = sideData.find((d) => d.side_data_type === 'Mastering display metadata');
  if (md) {
    const n = (key: string, scale: number) => {
      const [num, den] = String(md[key] ?? '0/1').split('/').map(Number);
      return Math.round((num / (den || 1)) * scale);
    };
    const xy = (c: string) => `${n(`${c}_x`, 50000)},${n(`${c}_y`, 50000)}`;
    meta.masterDisplay = `G(${xy('green')})B(${xy('blue')})R(${xy('red')})WP(${xy('white_point')})L(${n('max_luminance', 10000)},${n('min_luminance', 10000)})`;
  }
  const cll = sideData.find((d) => d.side_data_type === 'Content light level metadata');
  if (cll) meta.maxCll = `${cll.max_content},${cll.max_average}`;
  return meta;
}

export function parseProbe(path: string, raw: RawProbe): FileInfo {
  if (!raw.format) throw new ProbeError('Not a video or audio file');
  const streams = raw.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  return {
    path,
    container: raw.format.format_name ?? 'unknown',
    sizeBytes: positive(raw.format.size),
    durationSec: positive(raw.format.duration),
    video: video ? toVideo(video) : null,
    audio: streams.filter((s) => s.codec_type === 'audio').map(toAudio),
    subtitles: streams.filter((s) => s.codec_type === 'subtitle').map(toSubtitle),
    chapters: raw.chapters?.length ?? 0,
  };
}

export function lastLine(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1];
}

function toVideo(s: RawStream): VideoTrack {
  return {
    index: s.index,
    codec: s.codec_name ?? 'unknown',
    width: s.width ?? 0,
    height: s.height ?? 0,
    fps: frameRate(s.r_frame_rate) || frameRate(s.avg_frame_rate),
    bitDepth: bitDepth(s),
    hdr: hdrOf(s.color_transfer),
    rotation: rotationOf(s),
    durationSec: trackDuration(s),
    bitRate: bitRateOf(s),
  };
}

function rotationOf(s: RawStream): VideoTrack['rotation'] {
  const raw = s.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(s.tags?.rotate ?? 0);
  const degrees = (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
  if (degrees === 90 || degrees === 180 || degrees === 270) return degrees;
  return 0;
}

function toAudio(s: RawStream): AudioTrack {
  return {
    index: s.index,
    codec: s.codec_name ?? 'unknown',
    channels: s.channels ?? 2,
    language: s.tags?.language ?? 'und',
    durationSec: trackDuration(s),
    bitRate: bitRateOf(s),
  };
}

function toSubtitle(s: RawStream): SubtitleTrack {
  const codec = s.codec_name ?? 'unknown';
  return {
    index: s.index,
    codec,
    kind: IMAGE_SUBTITLE_CODECS.has(codec) ? 'image' : 'text',
    language: s.tags?.language ?? 'und',
  };
}

/**
 * MKV track statistics. mkvmerge writes them with a language suffix (BPS-eng, DURATION-eng); ffmpeg writes a plain
 * DURATION of its own. A file that has both was remuxed after mkvmerge, such as a clip cut from a film, and the
 * suffixed ones then still describe the whole film.
 */
function tagOf(s: RawStream, name: 'BPS' | 'DURATION'): string | undefined {
  const tags = Object.entries(s.tags ?? {});
  const plain = tags.find(([key]) => key.toUpperCase() === name)?.[1];
  if (plain !== undefined || (name === 'BPS' && tags.some(([key]) => key.toUpperCase() === 'DURATION'))) return plain;
  return tags.find(([key]) => key.toUpperCase().startsWith(`${name}-`))?.[1];
}

/** MP4 gives each stream a duration; MKV keeps it in a DURATION tag such as 00:02:07.012000000. */
function trackDuration(s: RawStream): number | undefined {
  const direct = positive(s.duration);
  if (direct) return direct;
  const tag = tagOf(s, 'DURATION');
  const match = tag ? /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(tag) : null;
  if (!match) return undefined;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Math.round(seconds * 1000) / 1000 || undefined;
}

/** Bits per second from the stream, or from MKV's BPS tag. */
function bitRateOf(s: RawStream): number | undefined {
  return positive(s.bit_rate) || positive(tagOf(s, 'BPS')) || undefined;
}

function positive(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function frameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

function bitDepth(s: RawStream): VideoTrack['bitDepth'] {
  const raw = Number(s.bits_per_raw_sample);
  if (raw === 8 || raw === 10 || raw === 12) return raw;
  // Deep formats end in their depth plus byte order (yuv420p10le, p010le); nv12 is plain 8-bit.
  const depth = /(10|12)(le|be)$/.exec(s.pix_fmt ?? '')?.[1];
  if (depth === '10') return 10;
  if (depth === '12') return 12;
  return 8;
}

function hdrOf(transfer: string | undefined): Hdr {
  if (transfer === 'smpte2084') return 'hdr10';
  if (transfer === 'arib-std-b67') return 'hlg';
  return 'sdr';
}
