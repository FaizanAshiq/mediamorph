import { describe, expect, it } from 'vitest';
import { burnChoices, fpsChoices, speedChoices, videoCodecChoices } from '../engine/choices';
import { DEFAULT_SETTINGS, FULL_MACHINE } from '../engine/types';
import { blueHarbourInfo, nightTrainInfo } from './support/fixtures';

const noLibass = { ...FULL_MACHINE, filters: new Set(['overlay', 'loudnorm']) };
const noHardware = { ...FULL_MACHINE, encoders: new Set(['libx264', 'libx265']) };

describe('choices', () => {
  it('offers codecs the format can hold', () => {
    expect(videoCodecChoices('mp4').map((c) => c.label)).toEqual(['Copy when possible', 'H.264', 'HEVC', 'AV1']);
    expect(videoCodecChoices('webm').map((c) => c.label)).toEqual(['Copy when possible', 'VP9', 'AV1']);
  });

  it('only offers frame rates below the source', () => {
    const fast = { ...nightTrainInfo().video!, fps: 59.94 };
    expect(fpsChoices(fast)).toEqual([
      { value: 'same', label: 'Same (59.94)', disabled: false },
      { value: '60', label: '60 fps (not lower than the original)', disabled: true },
      { value: '50', label: '50 fps', disabled: false },
      { value: '30', label: '30 fps', disabled: false },
      { value: '25', label: '25 fps', disabled: false },
      { value: '24', label: '24 fps', disabled: false },
    ]);
  });

  it('offers three speeds, saying what each costs, and why Fast is missing when it is', () => {
    expect(speedChoices(DEFAULT_SETTINGS, nightTrainInfo(), FULL_MACHINE)).toEqual([
      { value: 'fast', label: 'Fast', disabled: false, note: 'The video hardware in the Mac: several times quicker, a little softer at the same size.' },
      { value: 'balanced', label: 'Balanced', disabled: false, note: 'The usual trade between size and time.' },
      { value: 'smallest', label: 'Smallest file', disabled: false, note: 'About 20 percent smaller at the same look; takes about 2.7 times as long.' },
    ]);
    expect(speedChoices(DEFAULT_SETTINGS, nightTrainInfo(), noHardware)[0]).toMatchObject({ disabled: true, note: 'This computer has no hardware encoder.' });
    const av1 = { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, codec: 'av1' as const } };
    const forAv1 = speedChoices(av1, nightTrainInfo(), FULL_MACHINE);
    expect(forAv1[0]).toMatchObject({ disabled: true, note: 'There is no hardware encoder for AV1.' });
    expect(forAv1[2].note).toBe('About 3 percent smaller at the same look; takes about 1.5 times as long.');
  });

  it('lets text subtitles burn only with ffmpeg-full', () => {
    expect(burnChoices(nightTrainInfo(), FULL_MACHINE)).toEqual([{ value: '3', label: 'English (text)', disabled: false }]);
    expect(burnChoices(nightTrainInfo(), noLibass)).toEqual([{ value: '3', label: 'English (text, needs ffmpeg-full: brew install ffmpeg-full)', disabled: true }]);
    expect(burnChoices(blueHarbourInfo(), noLibass).map((c) => c.disabled)).toEqual([false, false]);
  });
});
