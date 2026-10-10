import { describe, expect, it } from 'vitest';
import { findTools, parseMachine, parseVersion } from '../engine/machine';

describe('findTools', () => {
  it('prefers ffmpeg-full, which can draw subtitles', async () => {
    const tools = await findTools(async () => 'ffmpeg version 9.0.2 Copyright');
    expect(tools).toEqual({ ffmpeg: 'ffmpeg-full', ffprobe: 'ffprobe-full', version: '9.0.2' });
  });

  it('falls back to Homebrew when PATH has no ffmpeg, as when opened from Finder', async () => {
    const working = new Set(['ffmpeg-homebrew', 'ffprobe-homebrew']);
    const tools = await findTools(async (name) => (working.has(name) ? 'ffmpeg version 8.0.1 Copyright (c) 2000-2025' : null));
    expect(tools).toEqual({ ffmpeg: 'ffmpeg-homebrew', ffprobe: 'ffprobe-homebrew', version: '8.0.1' });
  });

  it('then tries PATH before the other folders', async () => {
    const working = new Set(['ffmpeg-path', 'ffprobe-path', 'ffmpeg-homebrew', 'ffprobe-homebrew']);
    expect((await findTools(async (name) => (working.has(name) ? 'ffmpeg version 7.1' : null)))?.ffmpeg).toBe('ffmpeg-path');
  });

  it('returns null when either tool is missing', async () => {
    expect(await findTools(async (name) => (name.startsWith('ffmpeg') ? 'ffmpeg version 8' : null))).toBeNull();
  });
});

describe('parseMachine', () => {
  it('reads filter and encoder names from ffmpeg listings', () => {
    const filters = ['Filters:', '  T.. = Timeline support', ' ... subtitles         V->V       Render text subtitles', ' TSC loudnorm          A->A       EBU R128 loudness normalization', ' ... overlay           VV->V      Overlay a video'].join('\n');
    const encoders = ['Encoders:', ' V..... = Video', ' ------', ' V....D libx264              libx264 H.264', ' V....D hevc_videotoolbox    VideoToolbox H.265', ' A....D aac                  AAC'].join('\n');
    const machine = parseMachine(filters, encoders);
    expect([...machine.filters]).toEqual(['subtitles', 'loudnorm', 'overlay']);
    expect([...machine.encoders]).toEqual(['libx264', 'hevc_videotoolbox', 'aac']);
  });
});

describe('parseVersion', () => {
  it('reads the version word', () => {
    expect(parseVersion('ffmpeg version n8.0 Copyright')).toBe('n8.0');
    expect(parseVersion('garbage')).toBe('unknown');
  });
});
