/**
 * A path as a filter option value. ffmpeg unescapes twice, once for the filtergraph and once
 * for the option, so each level's special characters get their own backslash.
 */
export function escapeFilterPath(path: string): string {
  const option = path.replace(/[\\':]/g, (c) => `\\${c}`);
  return option.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

export type Burn = { kind: 'image'; subtitle: number; canvasWidth: number } | { kind: 'text'; path: string; si: number };

export interface VideoFilters {
  video: number;
  fps: number | null;
  scale: { width: number; height: number } | null;
  burn: Burn | null;
}

/**
 * The video's filter arguments and the map that picks its output. Image subtitles need a second
 * input stream, so they go through -filter_complex; everything else fits in -vf.
 */
export function videoFilterArgs(f: VideoFilters): string[] {
  const chain = [
    f.burn?.kind === 'text' ? `subtitles=filename=${escapeFilterPath(f.burn.path)}:si=${f.burn.si}` : null,
    f.fps ? `fps=${f.fps}` : null,
    f.scale ? `scale=${f.scale.width}:${f.scale.height}:flags=lanczos` : null,
  ].filter((part): part is string => part !== null);

  if (f.burn?.kind === 'image') {
    // Subtitle canvases are often taller than a cropped movie, so the scaled canvas sits on the bottom edge.
    const after = chain.length ? `,${chain.join(',')}` : '';
    const graph = `[0:${f.burn.subtitle}]scale=${f.burn.canvasWidth}:-1[subs];[0:${f.video}][subs]overlay=x=(W-w)/2:y=H-h:eof_action=pass${after}[v]`;
    return ['-filter_complex', graph, '-map', '[v]'];
  }
  return ['-map', `0:${f.video}`, ...(chain.length ? ['-vf', chain.join(',')] : [])];
}
