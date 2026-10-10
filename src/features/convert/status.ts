import type { Estimate } from './engine/estimate';
import { displaySize } from './engine/sizes';
import type { FileInfo, Plan } from './engine/types';
import { codecName, formatBytes, formatDuration } from './engine/words';
import type { OpenFile } from './store';

export function isCopy(plan: Plan): boolean {
  return plan.tracks.every((track) => track.action !== 'encode');
}

export function statusText(item: OpenFile): string {
  switch (item.status) {
    case 'probing':
      return 'Reading the file…';
    case 'ready':
      return item.plan && isCopy(item.plan) ? 'Ready · copy, no quality loss' : 'Ready · re-encode';
    case 'measuring':
      return 'Measuring loudness…';
    case 'first-pass':
      return `First pass: ${runningText(item)}`;
    case 'running':
      return runningText(item);
    case 'verifying':
      return 'Checking the result…';
    case 'done':
      return item.info && item.output ? `Done · ${formatBytes(item.info.sizeBytes)} → ${formatBytes(item.output.sizeBytes)}` : 'Done';
    case 'failed':
      return item.error ?? 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function runningText(item: OpenFile): string {
  const progress = item.progress;
  if (!progress || progress.fraction === null) return 'Converting…';
  const percent = `${Math.round(progress.fraction * 100)}%`;
  if (progress.etaSec === null) return percent;
  return progress.etaSec < 60 ? `${percent} · under a minute left` : `${percent} · ${formatDuration(progress.etaSec)} left`;
}

const SIZE_WORD: Record<Estimate['kind'], string> = { exact: '', measured: 'about ', guess: 'roughly ' };

/** The size in words: exact for copies, "about" once measured, "roughly" while only worked out. */
export function sizeText(estimate: Estimate | null | undefined): string | null {
  return estimate ? `${SIZE_WORD[estimate.kind]}${formatBytes(estimate.bytes)}` : null;
}

/** What the Quit dialog says while a file converts. */
export function quitMessage(): string {
  return 'The file is still converting. Quitting stops it and deletes the unfinished file.';
}

export function describeFile(info: FileInfo): string {
  const parts: string[] = [];
  const v = info.video;
  if (v) {
    const shown = displaySize(v);
    parts.push(`${codecName(v.codec)} ${shown.width}x${shown.height} ${v.bitDepth}-bit`, `${v.fps} fps`);
  }
  if (!v) parts.push('Sound only');
  if (info.durationSec) parts.push(formatDuration(info.durationSec));
  parts.push(formatBytes(info.sizeBytes));
  return parts.join(' · ');
}
