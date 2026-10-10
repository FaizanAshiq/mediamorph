import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Child, FileOps, LineHandlers, Program, RunOutput, Spawner } from '../../engine/ports';

/** Runs ffmpeg and ffprobe from PATH, or from `folder` when given. */
export function makeNodeSpawner(folder = ''): Spawner {
  const bin = (program: Program) => (folder ? join(folder, program) : program);
  return {
  run(program: Program, args: string[]): Promise<RunOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin(program), args);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  },
  async spawn(program: Program, args: string[], on: LineHandlers): Promise<Child> {
    const child = spawn(bin(program), args);
    createInterface({ input: child.stdout }).on('line', on.stdout);
    createInterface({ input: child.stderr }).on('line', on.stderr);
    const done = new Promise<{ code: number | null }>((resolve) => child.on('close', (code) => resolve({ code })));
    return {
      done,
      kill: async () => {
        child.kill('SIGTERM');
      },
    };
  },
  };
}

export const nodeSpawner = makeNodeSpawner();

let cache: Promise<string> | null = null;

export const nodeFiles: FileOps = {
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
  freeBytes: async (folder) => {
    const stats = await statfs(folder);
    return stats.bavail * stats.bsize;
  },
  markUnfinished: async () => {},
  cacheDir: () => (cache ??= mkdtemp(join(tmpdir(), 'mediamorph-cache-'))),
  configDir: async () => {
    const dir = join(tmpdir(), 'mediamorph-config');
    await mkdir(dir, { recursive: true });
    return dir;
  },
  readText: (path) => readFile(path, 'utf8').catch(() => null),
  writeText: (path, text) => writeFile(path, text),
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  trash: (path) => rm(path),
};
