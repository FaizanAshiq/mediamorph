import { describe, expect, it } from 'vitest';
import { createProgressTracker } from '../engine/progress';

describe('createProgressTracker', () => {
  it('turns out_time_us into a fraction and uses the last speed for the time left', () => {
    const track = createProgressTracker(100);
    expect(track('speed=2.0x')).toBeNull();
    expect(track('out_time_us=50000000')).toEqual({ fraction: 0.5, etaSec: 25 });
  });

  it('ignores N/A and unrelated lines', () => {
    const track = createProgressTracker(100);
    expect(track('out_time_us=N/A')).toEqual({ fraction: 0, etaSec: null });
    expect(track('frame=12')).toBeNull();
  });

  it('reports the end', () => {
    expect(createProgressTracker(100)('progress=end')).toEqual({ fraction: 1, etaSec: 0 });
  });

  it('gives no fraction when the length is unknown', () => {
    expect(createProgressTracker(0)('out_time_us=5000000')).toEqual({ fraction: null, etaSec: null });
  });
});
