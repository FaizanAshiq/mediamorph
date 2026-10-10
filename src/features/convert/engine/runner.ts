import { explainRunError } from './errors';
import { parseLoudnorm, secondPassFilter, type Measured } from './loudness';
import { folderOf, freeOutputPath, tempPathFor } from './naming';
import type { Child, FileOps, Spawner } from './ports';
import { lastLine, probe } from './probe';
import { createProgressTracker, type Progress } from './progress';
import type { FileInfo, Plan, Step } from './types';
import { verifyOutput } from './verify';
import { formatBytes, languageName } from './words';

export type RunPhase = 'measuring' | 'first-pass' | 'running' | 'verifying';

export type RunResult =
  | { status: 'done'; output: FileInfo; extras: string[]; warnings: string[] }
  | { status: 'failed'; reason: string; log: string[] }
  | { status: 'cancelled' };

export interface RunHandle {
  result: Promise<RunResult>;
  cancel(): Promise<void>;
}

export interface RunDeps {
  spawner: Spawner;
  files: FileOps;
}

const LOG_LINES = 200;
const PHASE: Record<Exclude<Step['kind'], 'export-srt'>, RunPhase> = {
  'measure-loudness': 'measuring',
  'first-pass': 'first-pass',
  encode: 'running',
};

type StepOutcome = { ok: true; lines: string[] } | { ok: false; result: RunResult };

export function runConversion(
  info: FileInfo,
  plan: Plan,
  deps: RunDeps,
  onProgress: (progress: Progress) => void,
  onPhase: (phase: RunPhase) => void,
): RunHandle {
  let child: Child | null = null;
  let cancelled = false;
  const temp = tempPathFor(info.path, plan.ext);
  const log: string[] = [];
  const unfinished = new Set<string>([temp]);

  const discard = async (): Promise<void> => {
    for (const path of unfinished) if (await deps.files.exists(path)) await deps.files.remove(path);
  };

  const keepLog = (line: string) => {
    if (!line.trim()) return;
    log.push(line);
    if (log.length > LOG_LINES) log.shift();
  };

  const runStep = async (step: Step, output: string[], dest: string[]): Promise<StepOutcome> => {
    const lines: string[] = [];
    const track = createProgressTracker(info.durationSec);
    const quiet = step.kind === 'measure-loudness' ? 'info' : 'error';
    child = await deps.spawner.spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', quiet, ...step.input, ...output, ...dest], {
      stdout: (line) => {
        const progress = track(line);
        if (progress) onProgress(progress);
      },
      stderr: (line) => {
        lines.push(line);
        if (step.kind !== 'measure-loudness') keepLog(line);
      },
    });
    if (cancelled) await child.kill();
    const { code } = await child.done;
    if (cancelled) {
      await discard();
      return { ok: false, result: { status: 'cancelled' } };
    }
    if (code !== 0) {
      if (step.kind === 'measure-loudness') lines.slice(-20).forEach(keepLog);
      await discard();
      return { ok: false, result: { status: 'failed', reason: explainRunError(lastLine(log.join('\n')) ?? ''), log } };
    }
    return { ok: true, lines };
  };

  const run = async (): Promise<RunResult> => {
    if (plan.minFreeBytes) {
      const free = await deps.files.freeBytes(folderOf(temp));
      if (free !== null && free < plan.minFreeBytes) {
        const reason = `Not enough free space: this needs about ${formatBytes(plan.minFreeBytes)} and the disk has ${formatBytes(free)} free. Free up space, then try again.`;
        return { status: 'failed', reason, log };
      }
    }
    await discard();
    await deps.files.markUnfinished(temp);

    const measured = new Map<string, Measured>();
    const needsCache = plan.steps.some((s) => s.output.some((a) => a.includes('{cache}')));
    const cache = needsCache ? await deps.files.cacheDir() : '';
    const fill = (output: string[]) =>
      output.map((arg) => {
        const token = /^\{loudnorm:(.+)\}$/.exec(arg);
        if (!token || plan.loudness === 'off') return arg.split('{cache}').join(cache);
        const m = measured.get(token[1]);
        if (!m) throw new Error(`No loudness measurement for ${token[1]}`);
        return secondPassFilter(plan.loudness, m, token[1].endsWith(':stereo'));
      });

    for (const step of plan.steps) {
      if (step.kind === 'export-srt') continue;
      onPhase(PHASE[step.kind]);
      const dest = step.to === 'temp' ? ['-progress', 'pipe:1', '-nostats', temp] : step.kind === 'first-pass' ? ['-progress', 'pipe:1', '-nostats', '-f', 'null', '-'] : ['-f', 'null', '-'];
      const outcome = await runStep(step, fill(step.output), dest);
      if (!outcome.ok) return outcome.result;
      if (step.kind === 'measure-loudness' && step.audio) {
        const m = parseLoudnorm(outcome.lines);
        if (!m) {
          await discard();
          return { status: 'failed', reason: 'The loudness could not be measured. Show details has the message from ffmpeg.', log: outcome.lines.slice(-20) };
        }
        measured.set(step.audio, m);
      }
    }

    onPhase('verifying');
    const out = await probe(deps.spawner, temp);
    const check = verifyOutput(out, plan.expect);
    if (!check.ok) {
      await discard();
      return { status: 'failed', reason: `The finished file failed its check: ${check.reason}. It was deleted; the original is untouched.`, log };
    }
    // Picked last, so a file that appeared during the run is never overwritten.
    const output = await freeOutputPath(info.path, plan.ext, deps.files.exists);
    await deps.files.rename(temp, output);
    unfinished.delete(temp);

    const extras: string[] = [];
    const warnings: string[] = [];
    for (const step of plan.steps) {
      if (step.kind !== 'export-srt' || typeof step.to !== 'object') continue;
      const ext = step.to.language && step.to.language !== 'und' ? `${step.to.language}.srt` : 'srt';
      const srtTemp = tempPathFor(info.path, ext);
      unfinished.add(srtTemp);
      await deps.files.markUnfinished(srtTemp);
      const outcome = await runStep(step, step.output, [srtTemp]);
      if (!outcome.ok) {
        if (outcome.result.status === 'cancelled') break;
        warnings.push(`The ${languageName(step.to.language)} .srt file could not be written.`);
        continue;
      }
      const final = await freeOutputPath(info.path, ext, deps.files.exists);
      await deps.files.rename(srtTemp, final);
      unfinished.delete(srtTemp);
      extras.push(final);
    }

    if (plan.trashOriginal) {
      await deps.files.trash(info.path).catch(() => warnings.push('The original could not be moved to the Trash.'));
    }
    return { status: 'done', output: { ...out, path: output }, extras, warnings };
  };

  const result = run()
    .catch(async (error: unknown): Promise<RunResult> => {
      await discard().catch(() => undefined);
      const raw = error instanceof Error ? error.message : String(error);
      log.push(raw);
      return { status: 'failed', reason: explainRunError(raw), log };
    })
    .finally(() => deps.files.markUnfinished(null).catch(() => undefined));

  return {
    result,
    cancel: async () => {
      cancelled = true;
      if (child) await child.kill();
    },
  };
}
