import { describe, expect, it } from 'vitest';
import { explainReadError, explainRunError } from '../engine/errors';

describe('explainReadError', () => {
  it('says what went wrong and what to do, in plain words', () => {
    expect(explainReadError('/m/notes.txt: Invalid data found when processing input')).toBe('This is not a video or audio file Mediamorph can read.');
    expect(explainReadError('/m/Movies: Is a directory')).toBe('This is a folder. Drop the video files inside it instead.');
    expect(explainReadError('/m/gone.mkv: No such file or directory')).toBe('This file is no longer there. It may have been moved or deleted.');
    expect(explainReadError('/m/a.mkv: Permission denied')).toBe('Mediamorph is not allowed to read this file. Check its permissions in Finder.');
    expect(explainReadError('something new')).toBe('Mediamorph could not read this file.');
  });
});

describe('explainRunError', () => {
  it('says what went wrong and what to do, in plain words', () => {
    expect(explainRunError('[out#0/mp4 @ 0x1] Error writing trailer: No space left on device')).toBe('The disk is full. Free up some space, then try again.');
    expect(explainRunError('/m/a.mediamorph-partial.mp4: Permission denied')).toBe(
      'Mediamorph cannot write next to this file. Move it to a folder you can write to, then try again.',
    );
    expect(explainRunError('/m/a.mkv: No such file or directory')).toBe('The file went missing while converting. It may have been moved or deleted.');
    expect(explainRunError('[out#0/mp4 @ 0x1] Nothing was written into output file')).toBe('ffmpeg stopped with an error. Show details has its message.');
  });
});
