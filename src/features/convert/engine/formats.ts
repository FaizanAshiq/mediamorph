import type { Format, VideoCodec } from './types';

export interface FormatRules {
  ext: string;
  label: string;
  /** Takes one audio track and no video. */
  audioOnly: boolean;
  /** Video codecs copied as they are; null means any. */
  videoCopy: ReadonlySet<string> | null;
  /** Audio codecs copied as they are; null means any. */
  audioCopy: ReadonlySet<string> | null;
  /** What text subtitles become, or null when the format holds none. */
  textSubtitles: 'mov_text' | 'webvtt' | 'copy' | null;
  imageSubtitles: boolean;
  /** Codecs offered when re-encoding, first one used for 'auto'. */
  videoCodecs: Exclude<VideoCodec, 'auto'>[];
  audioEncoder: 'aac' | 'libopus' | 'libmp3lame';
  faststart: boolean;
}

const MP4_VIDEO = ['h264', 'hevc', 'av1', 'mpeg4'];
const MP4_AUDIO = ['aac', 'mp3', 'ac3', 'eac3', 'alac'];

export const FORMATS: Record<Format, FormatRules> = {
  mp4: {
    ext: 'mp4',
    label: 'MP4',
    audioOnly: false,
    videoCopy: new Set(MP4_VIDEO),
    audioCopy: new Set(MP4_AUDIO),
    textSubtitles: 'mov_text',
    imageSubtitles: false,
    videoCodecs: ['h264', 'hevc', 'av1'],
    audioEncoder: 'aac',
    faststart: true,
  },
  mov: {
    ext: 'mov',
    label: 'MOV',
    audioOnly: false,
    videoCopy: new Set([...MP4_VIDEO, 'prores']),
    audioCopy: new Set([...MP4_AUDIO, 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le']),
    textSubtitles: 'mov_text',
    imageSubtitles: false,
    videoCodecs: ['h264', 'hevc'],
    audioEncoder: 'aac',
    faststart: true,
  },
  mkv: {
    ext: 'mkv',
    label: 'MKV',
    audioOnly: false,
    videoCopy: null,
    audioCopy: null,
    textSubtitles: 'copy',
    imageSubtitles: true,
    videoCodecs: ['h264', 'hevc', 'av1', 'vp9'],
    audioEncoder: 'aac',
    faststart: false,
  },
  webm: {
    ext: 'webm',
    label: 'WebM',
    audioOnly: false,
    videoCopy: new Set(['vp8', 'vp9', 'av1']),
    audioCopy: new Set(['opus', 'vorbis']),
    textSubtitles: 'webvtt',
    imageSubtitles: false,
    videoCodecs: ['vp9', 'av1'],
    audioEncoder: 'libopus',
    faststart: false,
  },
  m4a: {
    ext: 'm4a',
    label: 'Audio only (M4A)',
    audioOnly: true,
    videoCopy: new Set(),
    audioCopy: new Set(['aac', 'alac']),
    textSubtitles: null,
    imageSubtitles: false,
    videoCodecs: [],
    audioEncoder: 'aac',
    faststart: true,
  },
  mp3: {
    ext: 'mp3',
    label: 'Audio only (MP3)',
    audioOnly: true,
    videoCopy: new Set(),
    audioCopy: new Set(['mp3']),
    textSubtitles: null,
    imageSubtitles: false,
    videoCodecs: [],
    audioEncoder: 'libmp3lame',
    faststart: false,
  },
};

export const FORMAT_ORDER: Format[] = ['mp4', 'mkv', 'mov', 'webm', 'm4a', 'mp3'];

export function holds(set: ReadonlySet<string> | null, codec: string): boolean {
  return set === null || set.has(codec);
}
