import type { Spawner } from './ports';
import type { Machine } from './types';

/** Tauri shell command names, in the order to try them. Each maps to a path in capabilities/default.json. */
/** ffmpeg-full comes first: it has libass, which burning text subtitles needs. */
export const FFMPEG_CANDIDATES = ['ffmpeg-full', 'ffmpeg-path', 'ffmpeg-homebrew', 'ffmpeg-usr-local'];
export const FFPROBE_CANDIDATES = ['ffprobe-full', 'ffprobe-path', 'ffprobe-homebrew', 'ffprobe-usr-local'];

export interface Tools {
  ffmpeg: string;
  ffprobe: string;
  version: string;
}

/** Runs `<name> -version` and returns its first line, or null when it does not run. */
export type ToolCheck = (name: string) => Promise<string | null>;

export async function findTools(check: ToolCheck): Promise<Tools | null> {
  const ffmpeg = await firstWorking(FFMPEG_CANDIDATES, check);
  const ffprobe = await firstWorking(FFPROBE_CANDIDATES, check);
  if (!ffmpeg || !ffprobe) return null;
  return { ffmpeg: ffmpeg.name, ffprobe: ffprobe.name, version: parseVersion(ffmpeg.firstLine) };
}

/** Filter and encoder names from `ffmpeg -filters` and `ffmpeg -encoders`. */
export function parseMachine(filterList: string, encoderList: string): Machine {
  const filters = new Set<string>();
  for (const line of filterList.split('\n')) {
    const [, name, io] = line.trim().split(/\s+/);
    if (name && io?.includes('->')) filters.add(name);
  }
  const encoders = new Set<string>();
  for (const line of encoderList.split('\n')) {
    const [flags, name] = line.trim().split(/\s+/);
    if (name && /^[VAS][.A-Z]{5}$/.test(flags) && name !== '=') encoders.add(name);
  }
  return { filters, encoders };
}

export async function probeMachine(spawner: Spawner): Promise<Machine> {
  const [filters, encoders] = await Promise.all([
    spawner.run('ffmpeg', ['-hide_banner', '-filters']),
    spawner.run('ffmpeg', ['-hide_banner', '-encoders']),
  ]);
  return parseMachine(filters.stdout, encoders.stdout);
}

export function parseVersion(line: string): string {
  return /version\s+(\S+)/.exec(line)?.[1] ?? 'unknown';
}

async function firstWorking(names: string[], check: ToolCheck): Promise<{ name: string; firstLine: string } | null> {
  for (const name of names) {
    const firstLine = await check(name);
    if (firstLine) return { name, firstLine };
  }
  return null;
}
