import { describe, expect, it, vi } from 'vitest';

type Handler = (payload: unknown) => void;

class Emitter {
  private handlers: Record<string, Handler[]> = {};
  on(event: string, handler: Handler) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }
  emit(event: string, payload: unknown) {
    this.handlers[event]?.forEach((handler) => handler(payload));
  }
}

class FakeCommand extends Emitter {
  static last: FakeCommand;
  static output = '';
  stdout = new Emitter();
  stderr = new Emitter();
  constructor(
    readonly program: string,
    readonly args: string[],
  ) {
    super();
  }
  static create(program: string, args: string[] = []) {
    FakeCommand.last = new FakeCommand(program, args);
    return FakeCommand.last;
  }
  async spawn() {
    return { kill: async () => {} };
  }
  async execute() {
    return { code: 0, stdout: FakeCommand.output, stderr: '' };
  }
}

const invoke = vi.fn(async () => null);

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: FakeCommand }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const { createTauriSpawner, tauriFiles } = await import('../platform/tauri');

describe('createTauriSpawner', () => {
  it('keeps running after a shell error event and ends only on close', async () => {
    const stderr: string[] = [];
    const child = await createTauriSpawner({ ffmpeg: 'ffmpeg-homebrew', ffprobe: 'ffprobe-homebrew', version: '8' }).spawn('ffmpeg', [], {
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });
    let ended = false;
    void child.done.then(() => (ended = true));

    // The shell plugin raises `error` for an output line that is not valid UTF-8; ffmpeg is still running.
    FakeCommand.last.emit('error', 'invalid utf-8 sequence');
    await Promise.resolve();
    expect(ended).toBe(false);
    expect(stderr).toEqual(['invalid utf-8 sequence']);

    FakeCommand.last.emit('close', { code: 0, signal: null });
    await expect(child.done).resolves.toEqual({ code: 0 });
  });
});

describe('tauriFiles', () => {
  it('reads free space from df, in bytes', async () => {
    FakeCommand.output = [
      'Filesystem   1024-blocks      Used Available Capacity iused ifree %iused  Mounted on',
      '/dev/disk5s1   976284672 123456789 850000000    13%   123   456    1%   /Volumes/External Drive',
      '',
    ].join('\n');
    expect(await tauriFiles.freeBytes('/Volumes/External Drive/downloads/')).toBe(850000000 * 1024);
    expect(FakeCommand.last.program).toBe('df-bin');
    expect(FakeCommand.last.args).toEqual(['-k', '/Volumes/External Drive/downloads/']);
  });

  it('says it cannot tell when df gives nothing usable', async () => {
    FakeCommand.output = '';
    expect(await tauriFiles.freeBytes('/m/')).toBeNull();
  });

  it('tells the app which file is unfinished', async () => {
    await tauriFiles.markUnfinished('/m/a.mediamorph-partial.mp4');
    await tauriFiles.markUnfinished(null);
    expect(invoke).toHaveBeenNthCalledWith(1, 'set_active_temp', { path: '/m/a.mediamorph-partial.mp4' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_active_temp', { path: null });
  });
});
