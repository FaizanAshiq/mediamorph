import { invoke } from '@tauri-apps/api/core';
import { appCacheDir, appConfigDir } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readFile, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Command } from '@tauri-apps/plugin-shell';
import type { ToolCheck, Tools } from '../engine/machine';
import type { Comfort, FileOps, Program, Spawner } from '../engine/ports';
import { quitMessage } from '../status';

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'ts', 'm2ts', 'mts', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', '3gp', 'vob', 'asf'];

/** The copies inside the app run as sidecars; the rest by their name in the capabilities. */
const command = (name: string, args: string[]) => (name.startsWith('binaries/') ? Command.sidecar(name, args) : Command.create(name, args));

export const checkTool: ToolCheck = async (name) => {
  try {
    const out = await command(name, ['-version']).execute();
    if (out.code !== 0) return null;
    return out.stdout.split('\n')[0] || null;
  } catch {
    return null;
  }
};

export function createTauriSpawner(tools: Tools): Spawner {
  const nameFor = (program: Program) => (program === 'ffmpeg' ? tools.ffmpeg : tools.ffprobe);
  return {
    async run(program, args) {
      const out = await command(nameFor(program), args).execute();
      return { code: out.code, stdout: out.stdout, stderr: out.stderr };
    },
    async spawn(program, args, on) {
      const running = command(nameFor(program), args);
      running.stdout.on('data', on.stdout);
      running.stderr.on('data', on.stderr);
      // The plugin raises `error` for an output line it cannot decode while the process keeps
      // running, so it goes to the log; only `close` means the process has ended.
      running.on('error', (message) => on.stderr(String(message)));
      const done = new Promise<{ code: number | null }>((resolve) => {
        running.on('close', (data) => resolve({ code: data.code }));
      });
      const child = await running.spawn();
      return { done, kill: () => child.kill() };
    },
  };
}

export const tauriFiles: FileOps = {
  exists: (path) => exists(path),
  rename: (from, to) => rename(from, to),
  remove: (path) => remove(path),
  freeBytes: async (folder) => {
    try {
      const out = await Command.create('df-bin', ['-k', folder]).execute();
      // Second line, fourth column: available space in 1024-byte blocks.
      const available = Number(out.stdout.split('\n')[1]?.trim().split(/\s+/)[3]);
      return Number.isFinite(available) ? available * 1024 : null;
    } catch {
      return null;
    }
  },
  markUnfinished: async (path) => {
    await invoke('set_active_temp', { path });
  },
  cacheDir: () => ensured(appCacheDir()),
  configDir: () => ensured(appConfigDir()),
  readText: async (path) => ((await exists(path)) ? readTextFile(path) : null),
  writeText: (path, text) => writeTextFile(path, text),
  readBytes: (path) => readFile(path),
  trash: (path) => invoke('move_to_trash', { path }),
};

async function ensured(folder: Promise<string>): Promise<string> {
  const path = await folder;
  await mkdir(path, { recursive: true });
  return path;
}

export const tauriComfort: Comfort = {
  keepAwake: async (on) => {
    await invoke('keep_awake', { on }).catch(() => undefined);
  },
  notify: async (title, body) => {
    const allowed = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
    if (allowed) sendNotification({ title, body });
  },
};

export async function pickVideo(): Promise<string[]> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: 'Videos', extensions: VIDEO_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return picked ? [picked] : [];
}

/** Opens the folder holding a file, with the file selected: Finder on a Mac. */
let note: Promise<string | null> | null = null;

/** The version this start was updated to, asked once: the app forgets it on the first answer. */
export const updateNote = (): Promise<string | null> => (note ??= invoke<string | null>('update_note').catch(() => null));

export function showInFolder(path: string): Promise<void> {
  return revealItemInDir(path);
}

export function onDragAndDrop(on: { hover(active: boolean): void; drop(paths: string[]): void }): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'enter') on.hover(true);
    if (payload.type === 'leave') on.hover(false);
    if (payload.type === 'drop') on.drop(payload.paths);
  });
}

/** Asks before quitting mid-conversion; on Quit, stops ffmpeg and deletes the unfinished file first. */
export function guardQuit(busy: () => boolean, stop: () => Promise<void>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!busy()) return;
    const quit = await ask(quitMessage(), {
      title: 'Quit Mediamorph?',
      kind: 'warning',
      okLabel: 'Quit',
      cancelLabel: 'Keep converting',
    });
    if (!quit) {
      event.preventDefault();
      return;
    }
    await stop();
  });
}
