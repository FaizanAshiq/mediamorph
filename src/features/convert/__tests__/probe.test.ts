import { describe, expect, it } from 'vitest';
import type { Spawner } from '../engine/ports';
import { hdrMetaFrom, parseProbe, probe, ProbeError, type RawProbe } from '../engine/probe';
import blueHarbour from './fixtures/blue-harbour.json';
import nightTrain from './fixtures/night-train.json';

describe('parseProbe', () => {
  it('reads Night Train exactly', () => {
    expect(parseProbe('/m/night-train.mkv', nightTrain as unknown as RawProbe)).toEqual({
      path: '/m/night-train.mkv',
      container: 'matroska,webm',
      sizeBytes: 967553540,
      durationSec: 7602.926,
      video: { index: 0, codec: 'hevc', width: 1280, height: 528, fps: 23.976, bitDepth: 10, hdr: 'sdr', rotation: 0, durationSec: 7561.679, bitRate: 732462 },
      audio: [
        { index: 1, codec: 'aac', channels: 6, language: 'hin', durationSec: 7602.901, bitRate: 191789 },
        { index: 2, codec: 'aac', channels: 6, language: 'eng', durationSec: 7561.685, bitRate: 96000 },
      ],
      subtitles: [{ index: 3, codec: 'subrip', kind: 'text', language: 'eng' }],
      chapters: 0,
    });
  });

  it('reads a clip cut from a film by its own lengths, not the film statistics it still carries', () => {
    const film = { 'BPS-eng': '732462', 'DURATION-eng': '02:06:01.679000000', '_STATISTICS_WRITING_APP-eng': 'mkvmerge v41.0.0' };
    const info = parseProbe('/m/cut.mkv', {
      format: { duration: '68.524', size: '7958984', format_name: 'matroska,webm' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'hevc', width: 1280, height: 528, r_frame_rate: '24000/1001', tags: { ...film, DURATION: '00:01:06.814000000' } },
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6, tags: { ...film, 'BPS-eng': '191789', DURATION: '00:01:06.607000000' } },
      ],
    });
    expect(info.video).toMatchObject({ durationSec: 66.814, bitRate: undefined });
    expect(info.audio[0]).toMatchObject({ durationSec: 66.607, bitRate: undefined });
  });

  it('still reads the statistics of a file mkvmerge wrote last', () => {
    const info = parseProbe('/m/film.mkv', {
      format: { duration: '7602.926', size: '967553540' },
      streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', width: 1280, height: 528, r_frame_rate: '24000/1001', tags: { 'BPS-eng': '732462', 'DURATION-eng': '02:06:01.679000000' } }],
    });
    expect(info.video).toMatchObject({ durationSec: 7561.679, bitRate: 732462 });
  });

  it('reads Blue Harbour: image subtitles and 17 chapters', () => {
    const info = parseProbe('/m/cm.mkv', blueHarbour as unknown as RawProbe);
    expect(info.video).toMatchObject({ codec: 'h264', width: 720, height: 302, bitDepth: 8, hdr: 'sdr' });
    expect(info.audio.map((a) => a.language)).toEqual(['hin', 'eng']);
    expect(info.subtitles.map((s) => s.kind)).toEqual(['image', 'image']);
    expect(info.chapters).toBe(17);
  });

  it('skips cover art when looking for the video', () => {
    const info = parseProbe('/m/a.mkv', {
      format: { duration: '10', size: '100' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'h264', width: 640, height: 360, r_frame_rate: '30/1' },
      ],
    });
    expect(info.video).toMatchObject({ index: 1, codec: 'h264', fps: 30 });
  });

  it('reads the rotation phones store for portrait video', () => {
    const rotation = (stream: object) =>
      parseProbe('/m/a.mp4', { format: {}, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', ...stream }] }).video?.rotation;
    expect(rotation({ side_data_list: [{ rotation: 90 }] })).toBe(90);
    expect(rotation({ side_data_list: [{ rotation: -90 }] })).toBe(270);
    expect(rotation({ tags: { rotate: '180' } })).toBe(180);
    expect(rotation({})).toBe(0);
  });

  it('reads a track length from the stream or, in MKV, from its DURATION tag', () => {
    const info = parseProbe('/m/a.mp4', {
      format: {},
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', duration: '3.000000' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { 'DURATION-eng': '00:00:03.021000000' } },
        { index: 2, codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(info.video?.durationSec).toBe(3);
    expect(info.audio.map((a) => a.durationSec)).toEqual([3.021, undefined]);
  });

  it('treats a missing length as 0', () => {
    expect(parseProbe('/m/a.h264', { format: {}, streams: [] }).durationSec).toBe(0);
  });

  it('reads colour depth from the pixel format without mistaking nv12 for 12-bit', () => {
    const depth = (stream: object) =>
      parseProbe('/m/a.mkv', { format: {}, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', ...stream }] }).video?.bitDepth;
    expect(depth({ pix_fmt: 'nv12' })).toBe(8);
    expect(depth({ pix_fmt: 'nv12', bits_per_raw_sample: '8' })).toBe(8);
    expect(depth({ pix_fmt: 'p010le' })).toBe(10);
    expect(depth({ pix_fmt: 'yuv420p10le' })).toBe(10);
    expect(depth({ pix_fmt: 'yuv422p12be' })).toBe(12);
  });

  it('marks HDR10 and HLG', () => {
    const hdr = (transfer: string) =>
      parseProbe('/m/a.mkv', {
        format: {},
        streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', color_transfer: transfer }],
      }).video?.hdr;
    expect(hdr('smpte2084')).toBe('hdr10');
    expect(hdr('arib-std-b67')).toBe('hlg');
    expect(hdr('bt709')).toBe('sdr');
  });

  it('refuses output with no format section', () => {
    expect(() => parseProbe('/m/a.txt', {})).toThrow(ProbeError);
  });
});

describe('probe', () => {
  it('passes the path as its own argument and parses stdout', async () => {
    const calls: string[][] = [];
    const spawner: Spawner = {
      run: async (_program, args) => {
        calls.push(args);
        return { code: 0, stdout: JSON.stringify(nightTrain), stderr: '' };
      },
      spawn: async () => {
        throw new Error('not used');
      },
    };
    const info = await probe(spawner, "/m/Tom's movie.mkv");
    expect(calls[0][calls[0].length - 1]).toBe("/m/Tom's movie.mkv");
    expect(info.audio).toHaveLength(2);
  });

  it('turns an ffprobe failure into its last error line', async () => {
    const spawner: Spawner = {
      run: async () => ({ code: 1, stdout: '', stderr: 'x\n/m/notes.txt: Invalid data found when processing input\n' }),
      spawn: async () => {
        throw new Error('not used');
      },
    };
    await expect(probe(spawner, '/m/notes.txt')).rejects.toThrow('Invalid data found when processing input');
  });
});

describe('probe extras', () => {
  it('reads an audio bitrate from the stream or its BPS tag', () => {
    const info = parseProbe('/m/a.mkv', {
      format: {},
      streams: [
        { index: 0, codec_type: 'audio', codec_name: 'aac', bit_rate: '384000' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { 'BPS-eng': '640000' } },
        { index: 2, codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(info.audio.map((a) => a.bitRate)).toEqual([384000, 640000, undefined]);
  });

  it('turns HDR10 frame side data into x265 notation', () => {
    expect(
      hdrMetaFrom([
        {
          side_data_type: 'Mastering display metadata',
          red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
          blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000',
          min_luminance: '50/10000', max_luminance: '10000000/10000',
        },
        { side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 },
      ]),
    ).toEqual({ masterDisplay: 'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50)', maxCll: '1000,400' });
    expect(hdrMetaFrom([])).toEqual({});
  });
});
