import { parseProbe, type RawProbe } from '../../engine/probe';
import type { FileInfo } from '../../engine/types';
import blueHarbour from '../fixtures/blue-harbour.json';
import nightTrain from '../fixtures/night-train.json';

export const nightTrainInfo = (path = '/m/Night Train.mkv'): FileInfo => parseProbe(path, nightTrain as unknown as RawProbe);
export const blueHarbourInfo = (path = '/m/Blue Harbour.mkv'): FileInfo =>
  parseProbe(path, blueHarbour as unknown as RawProbe);

/** A made-up 1080p download: HEVC 1920x800, two AAC 5.1 tracks, one SRT. */
export function makeInfo(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    path: '/m/Night Train 2.mkv',
    container: 'matroska,webm',
    sizeBytes: 4000000000,
    durationSec: 7440,
    video: { index: 0, codec: 'hevc', width: 1920, height: 800, fps: 23.976, bitDepth: 10, hdr: 'sdr', rotation: 0 },
    audio: [
      { index: 1, codec: 'aac', channels: 6, language: 'hin' },
      { index: 2, codec: 'aac', channels: 6, language: 'eng' },
    ],
    subtitles: [{ index: 3, codec: 'subrip', kind: 'text', language: 'eng' }],
    chapters: 0,
    ...overrides,
  };
}
