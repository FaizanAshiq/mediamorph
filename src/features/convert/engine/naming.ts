function splitPath(path: string): { dir: string; base: string } {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return { dir: path.slice(0, slash + 1), base: dot > 0 ? file.slice(0, dot) : file };
}

export function folderOf(path: string): string {
  return splitPath(path).dir;
}

export function tempPathFor(source: string, ext: string): string {
  const { dir, base } = splitPath(source);
  return `${dir}${base}.mediamorph-partial.${ext}`;
}

/** First name that is not taken: `name.mp4`, then `name (2).mp4`, `name (3).mp4`. */
export async function freeOutputPath(source: string, ext: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  const { dir, base } = splitPath(source);
  const first = `${dir}${base}.${ext}`;
  if (!(await exists(first))) return first;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${dir}${base} (${n}).${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free name left for ${base}.${ext}`);
}

/** A short stable name for cache files made from a path, so two files never share one. */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
