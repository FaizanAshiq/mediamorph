import { describe, expect, it } from 'vitest';
import { plan } from '../engine/planner';
import { DEFAULT_SETTINGS } from '../engine/types';
import { describeFile, quitMessage, statusText } from '../status';
import type { OpenFile } from '../store';
import { nightTrainInfo } from './support/fixtures';

const item = (changes: Partial<OpenFile>): OpenFile => ({
  path: '/m/Night Train.mkv',
  name: 'Night Train.mkv',
  status: 'ready',
  settings: DEFAULT_SETTINGS,
  presetName: null,
  ...changes,
});

describe('statusText', () => {
  it('says what each state means', () => {
    const info = nightTrainInfo();
    expect(statusText(item({ status: 'probing' }))).toBe('Reading the file…');
    expect(statusText(item({ info, plan: plan(info, DEFAULT_SETTINGS) }))).toBe('Ready · copy, no quality loss');
    expect(statusText(item({ status: 'running', progress: { fraction: 0.42, etaSec: 660 } }))).toBe('42% · 11 min left');
    expect(statusText(item({ status: 'running', progress: { fraction: 0.99, etaSec: 20 } }))).toBe('99% · under a minute left');
    expect(statusText(item({ status: 'running', progress: { fraction: null, etaSec: null } }))).toBe('Converting…');
    expect(statusText(item({ status: 'verifying' }))).toBe('Checking the result…');
    expect(statusText(item({ status: 'done', info, output: { ...info, sizeBytes: 972554240 } }))).toBe('Done · 968 MB → 973 MB');
    expect(statusText(item({ status: 'failed', error: 'Has 0 audio tracks, expected 2' }))).toBe('Has 0 audio tracks, expected 2');
  });
});

describe('quitMessage', () => {
  it('says what quitting mid-conversion does', () => {
    expect(quitMessage()).toBe('The file is still converting. Quitting stops it and deletes the unfinished file.');
  });
});

describe('describeFile', () => {
  it('sums up a file in one line', () => {
    expect(describeFile(nightTrainInfo())).toBe('HEVC 1280x528 10-bit · 23.976 fps · 2 h 7 min · 968 MB');
  });
});

describe('statusText: steps 2 to 5', () => {
  it('names the loudness and first-pass steps', () => {
    expect(statusText(item({ status: 'measuring' }))).toBe('Measuring loudness…');
    expect(statusText(item({ status: 'first-pass', progress: { fraction: 0.42, etaSec: null } }))).toBe('First pass: 42%');
  });
});
