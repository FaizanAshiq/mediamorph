export type SubtitleKind = 'text' | 'image';
export type Hdr = 'sdr' | 'hdr10' | 'hlg';

export interface VideoTrack {
  index: number;
  codec: string;
  width: number;
  height: number;
  fps: number;
  bitDepth: 8 | 10 | 12;
  hdr: Hdr;
  /** Degrees the player turns the stored picture; phones store portrait video as landscape plus 90 or 270. */
  rotation: 0 | 90 | 180 | 270;
  /** This track's own length; missing when the file does not say. */
  durationSec?: number;
  /** Bits per second, when the file says. */
  bitRate?: number;
  /** HDR10 mastering data in x265's notation, read from the first frame. */
  hdrMeta?: { masterDisplay?: string; maxCll?: string };
}

export interface AudioTrack {
  index: number;
  codec: string;
  channels: number;
  language: string;
  durationSec?: number;
  /** Bits per second, from the stream or its BPS tag; missing when the file does not say. */
  bitRate?: number;
}

export interface SubtitleTrack {
  index: number;
  codec: string;
  kind: SubtitleKind;
  language: string;
}

export interface FileInfo {
  path: string;
  /** ffprobe's format name, such as matroska,webm or image2. */
  container: string;
  sizeBytes: number;
  /** 0 when the file does not say how long it is. */
  durationSec: number;
  video: VideoTrack | null;
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
  chapters: number;
}

export type Size = 'original' | 2160 | 1080 | 720 | 480;
export type Format = 'mp4' | 'mkv' | 'mov' | 'webm' | 'm4a' | 'mp3';
export type VideoCodec = 'auto' | 'h264' | 'hevc' | 'av1' | 'vp9';
export type Speed = 'fast' | 'balanced' | 'smallest';
export type Loudness = 'off' | 'streaming' | 'eu-tv' | 'us-tv';
/** `quality` runs from 0 (smallest file) to 100 (the original's quality) in steps of 5. */
export type Rate = { mode: 'quality'; quality: number } | { mode: 'target'; bytes: number } | { mode: 'bitrate'; kbps: number };

export interface Settings {
  format: Format;
  size: Size;
  fps: 'same' | number;
  video: {
    /** 'auto' copies when it can, otherwise uses the format's usual codec. */
    codec: VideoCodec;
    bitDepth: 'same' | 8 | 10;
    rate: Rate;
    /** Fast: the hardware encoder. Balanced: the usual. Smallest: a slower preset, about 20 percent smaller at the same look. */
    speed: Speed;
  };
  audio: {
    /** 'all', or the source indexes kept. */
    keep: 'all' | number[];
    /** Source index of the track players pick first; null means the first kept track. */
    first: number | null;
    loudness: Loudness;
    addStereo: boolean;
  };
  subtitles: {
    /** 'auto' keeps every subtitle the format can hold. */
    keep: 'auto' | number[];
    saveSrt: boolean;
    /** Source index of the subtitle drawn onto the picture, or null. */
    burn: number | null;
  };
  trashOriginal: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  format: 'mp4',
  size: 'original',
  fps: 'same',
  video: { codec: 'auto', bitDepth: 'same', rate: { mode: 'quality', quality: 100 }, speed: 'balanced' },
  audio: { keep: 'all', first: null, loudness: 'off', addStereo: false },
  subtitles: { keep: 'auto', saveSrt: false, burn: null },
  trashOriginal: false,
};

/** What the found ffmpeg can do: its filter and encoder names. */
export interface Machine {
  filters: ReadonlySet<string>;
  encoders: ReadonlySet<string>;
}

export const FULL_MACHINE: Machine = {
  filters: new Set(['subtitles', 'overlay', 'loudnorm', 'fps', 'scale']),
  encoders: new Set(['libx264', 'libx265', 'libsvtav1', 'libvpx-vp9', 'h264_videotoolbox', 'hevc_videotoolbox', 'aac', 'libmp3lame', 'libopus']),
};

export type TrackAction = 'copy' | 'encode' | 'drop' | 'burn';

export interface TrackPlan {
  source: number;
  kind: 'video' | 'audio' | 'subtitle';
  action: TrackAction;
  why: string;
  /** Bits per second of a re-encoded audio track. */
  bitRate?: number;
}

/** How the video's size is decided, so sizes can be worked out without encoding anything. */
export type VideoRate =
  | { kind: 'none' }
  | { kind: 'copy' }
  | { kind: 'crf'; codec: string; speed: Speed; pixelsPerSec: number; crf: number; capKbps: number | null }
  | { kind: 'average'; codec: string; speed: Speed; pixelsPerSec: number; kbps: number }
  | { kind: 'unknown'; codec: string; speed: Speed; pixelsPerSec: number };

export interface Expectation {
  durationSec: number;
  audioTracks: number;
  subtitleTracks: number;
  video: { width: number; height: number } | null;
}

export type StepKind = 'measure-loudness' | 'first-pass' | 'encode' | 'export-srt';

/**
 * One ffmpeg run. The runner adds the global flags and the destination; `output` may hold
 * {cache} and {loudnorm:<audio>} tokens that it fills in.
 */
export interface Step {
  kind: StepKind;
  /** Options before and including `-i <source>`. */
  input: string[];
  output: string[];
  to: 'temp' | 'null' | { srt: number; language: string };
  /** measure-loudness only: the token key this measurement fills, such as '1' or '1:stereo'. */
  audio?: string;
}

export interface Plan {
  ext: string;
  tracks: TrackPlan[];
  steps: Step[];
  summary: string[];
  warnings: string[];
  expect: Expectation;
  /** Space to check for before starting: about the source size when the video is copied, null until estimates exist. */
  minFreeBytes: number | null;
  /** The video's own arguments when it is re-encoded (map, filters, encoder; no pass flags), for samples and previews. */
  videoArgs: string[] | null;
  videoRate: VideoRate;
  /** The loudness target the {loudnorm:<audio>} tokens aim for. */
  loudness: Loudness;
  trashOriginal: boolean;
}
