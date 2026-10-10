import { describe, expect, it } from 'vitest';
import { freeOutputPath, tempPathFor } from '../engine/naming';

const taken = (...paths: string[]) => async (path: string) => paths.includes(path);

describe('freeOutputPath', () => {
  it('uses the source name with the new extension', async () => {
    expect(await freeOutputPath('/m/Night Train.mkv', 'mp4', taken())).toBe('/m/Night Train.mp4');
  });

  it('counts up instead of overwriting', async () => {
    expect(await freeOutputPath('/m/Night Train.mkv', 'mp4', taken('/m/Night Train.mp4', '/m/Night Train (2).mp4'))).toBe('/m/Night Train (3).mp4');
  });

  it('never picks the source itself when it is already an MP4', async () => {
    expect(await freeOutputPath('/m/clip.mp4', 'mp4', taken('/m/clip.mp4'))).toBe('/m/clip (2).mp4');
  });

  it('handles names with no extension and Windows paths', async () => {
    expect(await freeOutputPath('/m/raw', 'mp4', taken())).toBe('/m/raw.mp4');
    expect(await freeOutputPath('C:\\m\\a.mkv', 'mp4', taken())).toBe('C:\\m\\a.mp4');
  });
});

describe('tempPathFor', () => {
  it('writes beside the source under a name that says it is unfinished', () => {
    expect(tempPathFor('/m/Night Train.mkv', 'mp4')).toBe('/m/Night Train.mediamorph-partial.mp4');
  });
});
