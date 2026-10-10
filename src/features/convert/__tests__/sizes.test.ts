import { describe, expect, it } from 'vitest';
import { fitInBox, sizeChoices } from '../engine/sizes';

describe('fitInBox', () => {
  it('fits a wide 1080p movie into 720p the way release groups do', () => {
    expect(fitInBox(1920, 800, 720)).toEqual({ width: 1280, height: 534 });
  });

  it('fits a 16:9 1080p video exactly', () => {
    expect(fitInBox(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('returns null when the video already fits, so it is never enlarged', () => {
    expect(fitInBox(1280, 528, 720)).toBeNull();
    expect(fitInBox(1280, 528, 1080)).toBeNull();
    expect(fitInBox(1280, 528, 'original')).toBeNull();
  });

  it('uses an 854 wide box for 480p', () => {
    expect(fitInBox(1280, 528, 480)).toEqual({ width: 854, height: 352 });
  });
});

describe('sizeChoices', () => {
  it('greys out sizes that are not smaller than the original', () => {
    expect(sizeChoices({ width: 1280, height: 528 })).toEqual([
      { value: 'original', label: 'Original (1280x528)', disabled: false },
      { value: 2160, label: '4K (not smaller than the original)', disabled: true },
      { value: 1080, label: '1080p (not smaller than the original)', disabled: true },
      { value: 720, label: '720p (not smaller than the original)', disabled: true },
      { value: 480, label: '480p (854x352)', disabled: false },
    ]);
  });

  it('offers only Original for audio-only files', () => {
    expect(sizeChoices(null)).toEqual([{ value: 'original', label: 'Original', disabled: false }]);
  });
});
