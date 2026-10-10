export interface Progress {
  fraction: number | null;
  etaSec: number | null;
}

/** Reads `ffmpeg -progress pipe:1` output one line at a time. */
export function createProgressTracker(durationSec: number): (line: string) => Progress | null {
  let outSec = 0;
  let speed = 0;

  const current = (): Progress => {
    if (!durationSec) return { fraction: null, etaSec: null };
    const fraction = Math.min(1, Math.max(0, outSec / durationSec));
    return { fraction, etaSec: speed ? Math.max(0, (durationSec - outSec) / speed) : null };
  };

  return (line) => {
    const eq = line.indexOf('=');
    if (eq < 0) return null;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'speed') {
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0) speed = n;
      return null;
    }
    if (key === 'out_time_us') {
      const n = Number(value);
      if (Number.isFinite(n)) outSec = n / 1e6;
      return current();
    }
    if (key === 'progress' && value === 'end') return { fraction: durationSec ? 1 : null, etaSec: 0 };
    return null;
  };
}
