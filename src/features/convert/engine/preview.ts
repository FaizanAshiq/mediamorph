import type { Child } from './ports';
import type { RunDeps } from './runner';
import type { FileInfo, Plan } from './types';

export interface Preview {
  /** 10 s of the original, from the same moment and at the output size, for the window to play. */
  before: string;
  /** The same 10 s with these settings: the real encode when the window can play it, else a near-lossless copy of it. */
  after: string;
  width: number;
  height: number;
}

export interface PreviewHandle {
  result: Promise<Preview | null>;
  cancel(): void;
}

const SAMPLE_SEC = 10;
/** How a clip is shown when it cannot be played as it is: H.264 at CRF 12 is past what the eye can tell, and every Mac plays it. */
const SHOWN = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
/** Codecs the window plays as they are. AV1 needs an M3 or later, and VP9 in MP4 is not certain, so those go through SHOWN. */
const PLAYABLE = new Set(['h264', 'hevc']);

/**
 * Encodes 10 seconds from a third of the way in with the plan's video settings, and cuts the same 10 seconds from the
 * original, so the window can play them side by side. Picture only. Copies have no preview: nothing changes.
 */
export function preview(info: FileInfo, plan: Plan, deps: RunDeps): PreviewHandle {
  let cancelled = false;
  let child: Child | null = null;
  const size = plan.expect.video;

  const ffmpeg = async (args: string[]): Promise<boolean> => {
    if (cancelled) return false;
    child = await deps.spawner.spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { stdout: () => {}, stderr: () => {} });
    if (cancelled) await child.kill();
    const { code } = await child.done;
    return !cancelled && code === 0;
  };

  const make = async (videoArgs: string[], out: { width: number; height: number }): Promise<Preview | null> => {
    if (!info.video) return null;
    const cache = await deps.files.cacheDir();
    const length = info.durationSec;
    const start = String(length >= 30 ? Math.floor(length / 3) : 0);
    const cut = ['-ss', start, '-i', info.path, '-t', String(SAMPLE_SEC)];
    const sample = `${cache}/preview-sample.mkv`;
    const before = `${cache}/preview-before.mp4`;
    const after = `${cache}/preview-after.mp4`;
    const codec = 'codec' in plan.videoRate ? plan.videoRate.codec : '';

    if (!(await ffmpeg([...cut, ...videoArgs.map((a) => a.split('{cache}').join(cache)), '-an', '-sn', sample]))) return null;
    const shownAfter = PLAYABLE.has(codec)
      ? ['-c', 'copy', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart']
      : SHOWN;
    if (!(await ffmpeg(['-i', sample, '-map', '0:v', ...shownAfter, after]))) return null;
    const scale = ['-vf', `scale=${out.width}:${out.height}:flags=lanczos`];
    if (!(await ffmpeg([...cut, '-map', `0:${info.video.index}`, ...scale, ...SHOWN, '-an', '-sn', before]))) return null;
    return { before, after, width: out.width, height: out.height };
  };

  const result = plan.videoArgs && size ? make(plan.videoArgs, size).catch(() => null) : Promise.resolve(null);
  return {
    result,
    cancel: () => {
      cancelled = true;
      void child?.kill();
    },
  };
}
