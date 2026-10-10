import { shortHash } from './naming';
import type { RunDeps } from './runner';
import type { FileInfo } from './types';

/** A picture from about a third of the way in: ffmpeg picks the most typical of the 100 frames there. */
export async function frame(info: FileInfo, deps: RunDeps): Promise<string | null> {
  if (!info.video || !info.durationSec) return null;
  const out = `${await deps.files.cacheDir()}/frame-${shortHash(info.path)}.jpg`;
  const at = String(Math.floor(info.durationSec * 0.3));
  const made = await deps.spawner.run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-ss', at, '-i', info.path, '-map', `0:${info.video.index}`,
    '-vf', 'thumbnail=100,scale=840:-2', '-frames:v', '1', '-q:v', '3', out,
  ]);
  return made.code === 0 ? out : null;
}
