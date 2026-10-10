import { describe, expect, it } from 'vitest';
import { codecName, describeAudio, formatBytes, formatDuration, joinWords, languageName, layoutName } from '../engine/words';

describe('words', () => {
  it('names languages from their codes', () => {
    expect(languageName('hin')).toBe('Hindi');
    expect(languageName('eng')).toBe('English');
    expect(languageName('und')).toBe('Unknown language');
    expect(languageName('qqq')).toBe('QQQ');
  });

  it('names channel layouts', () => {
    expect([1, 2, 6, 8, 3].map(layoutName)).toEqual(['mono', 'stereo', '5.1', '7.1', '3 channel']);
  });

  it('names codecs', () => {
    expect(codecName('hevc')).toBe('HEVC');
    expect(codecName('weird')).toBe('WEIRD');
  });

  it('describes an audio track', () => {
    expect(describeAudio({ index: 1, codec: 'aac', channels: 6, language: 'hin' })).toBe('Hindi 5.1');
  });

  it('joins words like a person would', () => {
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b'])).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('formats sizes and lengths', () => {
    // Same as Finder: 1 MB is 1,000,000 bytes.
    expect(formatBytes(967553540)).toBe('968 MB');
    expect(formatBytes(4000000000)).toBe('4.0 GB');
    expect(formatDuration(7602.9)).toBe('2 h 7 min');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(20)).toBe('under a minute');
  });
});
