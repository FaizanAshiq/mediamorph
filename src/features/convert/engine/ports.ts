export type Program = 'ffmpeg' | 'ffprobe';

export interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface LineHandlers {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface Child {
  done: Promise<{ code: number | null }>;
  kill(): Promise<void>;
}

/** Starts ffmpeg or ffprobe. Arguments always travel as a list, never through a shell. */
export interface Spawner {
  run(program: Program, args: string[]): Promise<RunOutput>;
  spawn(program: Program, args: string[], on: LineHandlers): Promise<Child>;
}

export interface FileOps {
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Free bytes on the disk holding this folder, or null when it cannot be told. */
  freeBytes(folder: string): Promise<number | null>;
  /** Names the file being written, or null when none is, so an app exit can delete a half-written file. */
  markUnfinished(path: string | null): Promise<void>;
  /** A folder for samples, previews and pass logs; created when missing. */
  cacheDir(): Promise<string>;
  /** The app's settings folder, for presets; created when missing. */
  configDir(): Promise<string>;
  /** The file's text, or null when it does not exist. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  trash(path: string): Promise<void>;
}

/** Things the app does for the person while the queue runs. */
export interface Comfort {
  keepAwake(on: boolean): Promise<void>;
  notify(title: string, body: string): Promise<void>;
}
