import { describe, expect, it } from 'vitest';
import { plan, PlanError } from '../engine/planner';
import { DEFAULT_SETTINGS, FULL_MACHINE, type Machine, type Plan, type Settings } from '../engine/types';
import { blueHarbourInfo, nightTrainInfo, makeInfo } from './support/fixtures';

type Patch = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

/** DEFAULT_SETTINGS with one level of nested overrides. */
const with_ = (patch: Patch = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
  video: { ...DEFAULT_SETTINGS.video, ...patch.video },
  audio: { ...DEFAULT_SETTINGS.audio, ...patch.audio },
  subtitles: { ...DEFAULT_SETTINGS.subtitles, ...patch.subtitles },
});
const at = (size: Settings['size'], quality = 100) => with_({ size, video: { rate: { mode: 'quality', quality } } });
const encode = (p: Plan) => p.steps.find((s) => s.kind === 'encode')!;
const out = (p: Plan) => encode(p).output;
const machine = (drop: string[]): Machine => ({
  filters: new Set([...FULL_MACHINE.filters].filter((f) => !drop.includes(f))),
  encoders: new Set([...FULL_MACHINE.encoders].filter((e) => !drop.includes(e))),
});

describe('plan: copying', () => {
  it('copies Night Train untouched, keeping its English SRT as an MP4 subtitle', () => {
    const p = plan(nightTrainInfo(), DEFAULT_SETTINGS);
    expect(p.steps).toHaveLength(1);
    expect(encode(p).input).toEqual(['-i', '/m/Night Train.mkv']);
    expect(encode(p).to).toBe('temp');
    expect(out(p)).toEqual([
      '-map', '0:0', '-c:v', 'copy', '-tag:v', 'hvc1',
      '-map', '0:1', '-c:a:0', 'copy',
      '-map', '0:2', '-c:a:1', 'copy',
      '-disposition:a:0', 'default', '-disposition:a:1', '0',
      '-map', '0:3', '-c:s:0', 'mov_text', '-disposition:s:0', '0',
      '-movflags', '+faststart', '-max_muxing_queue_size', '4096',
    ]);
    expect(p.summary).toEqual([
      'Video: copied, no quality loss',
      'Audio: Hindi 5.1 and English 5.1 copied',
      'Subtitles: English kept inside the MP4',
    ]);
    expect(p.expect).toEqual({ durationSec: 7602.901, audioTracks: 2, subtitleTracks: 1, video: { width: 1280, height: 528 } });
    expect(p.warnings).toEqual([]);
  });

  it('trusts the file length over longer track lengths, which a clip cut from a film keeps in its tags', () => {
    const cut = { ...nightTrainInfo(), durationSec: 68.524 };
    expect(plan(cut, DEFAULT_SETTINGS).expect.durationSec).toBe(68.524);
  });

  it('leaves out image subtitles MP4 cannot hold, saying how to keep them', () => {
    const p = plan(blueHarbourInfo(), DEFAULT_SETTINGS);
    expect(out(p)).not.toContain('-tag:v');
    expect(p.summary).toEqual([
      'Video: copied, no quality loss',
      'Audio: Hindi stereo and English stereo copied',
      'Subtitles: 2 image tracks left out: MP4 cannot hold them (burn them in or choose MKV)',
      'Chapters: 17 kept',
    ]);
    expect(p.expect.subtitleTracks).toBe(0);
  });

  it('asks for as much free space as the source when copying, and nothing yet when re-encoding', () => {
    expect(plan(nightTrainInfo(), DEFAULT_SETTINGS).minFreeBytes).toBe(967553540);
    expect(plan(makeInfo(), at(720)).minFreeBytes).toBeNull();
  });

  it('treats a size bigger than the source as Original and copies', () => {
    expect(plan(nightTrainInfo(), at(1080)).summary[0]).toBe('Video: copied, no quality loss');
  });
});

describe('plan: tracks', () => {
  it('maps only the audio tracks kept', () => {
    const p = plan(nightTrainInfo(), with_({ audio: { keep: [2] } }));
    expect(out(p)).toEqual(expect.arrayContaining(['-map', '0:2', '-c:a:0', 'copy']));
    expect(out(p)).not.toContain('0:1');
    expect(out(p)).not.toContain('-disposition:a:0');
    expect(p.expect.audioTracks).toBe(1);
    expect(p.summary[1]).toBe('Audio: English 5.1 copied');
  });

  it('marks the track that plays first', () => {
    const p = plan(nightTrainInfo(), with_({ audio: { first: 2 } }));
    expect(out(p)).toEqual(expect.arrayContaining(['-disposition:a:0', '0', '-disposition:a:1', 'default']));
    expect(p.summary[1]).toBe('Audio: Hindi 5.1 and English 5.1 copied, English 5.1 plays first');
  });

  it('leaves out subtitles that are not ticked', () => {
    const p = plan(nightTrainInfo(), with_({ subtitles: { keep: [] } }));
    expect(out(p)).not.toContain('0:3');
    expect(p.summary[2]).toBe('Subtitles: 1 track left out');
    expect(p.expect.subtitleTracks).toBe(0);
  });

  it('adds a step that saves each kept text subtitle as .srt', () => {
    const p = plan(nightTrainInfo(), with_({ subtitles: { saveSrt: true } }));
    const srt = p.steps.find((s) => s.kind === 'export-srt')!;
    expect(srt).toEqual({ kind: 'export-srt', input: ['-i', '/m/Night Train.mkv'], output: ['-map', '0:3', '-c:s', 'srt'], to: { srt: 3, language: 'eng' } });
    expect(p.summary[2]).toBe('Subtitles: English kept inside the MP4, also saved as .srt');
  });
});

describe('plan: burning subtitles in', () => {
  it('overlays an image subtitle, scaled to the picture width and sitting on its bottom edge', () => {
    const p = plan(blueHarbourInfo(), with_({ subtitles: { burn: 3 } }));
    const o = out(p);
    const graph = o[o.indexOf('-filter_complex') + 1];
    expect(graph).toBe('[0:3]scale=720:-1[subs];[0:0][subs]overlay=x=(W-w)/2:y=H-h:eof_action=pass[v]');
    expect(o).toEqual(expect.arrayContaining(['-map', '[v]', '-c:v', 'libx264']));
    expect(p.tracks[0].why).toBe('Burning subtitles in needs a re-encode');
    expect(p.summary).toContain('Subtitles: English burned into the picture; 1 image track left out: MP4 cannot hold it (burn it in or choose MKV)');
  });

  it('draws a text subtitle with the subtitles filter, escaping the path', () => {
    const p = plan(nightTrainInfo("/m/Tom's: [cut], 1.mkv"), with_({ subtitles: { burn: 3 } }));
    expect(out(p)).toContain("subtitles=filename=/m/Tom\\\\\\'s\\\\: \\[cut\\]\\, 1.mkv:si=0");
    expect(out(p)).not.toContain('-c:s:0');
    expect(p.expect.subtitleTracks).toBe(0);
  });

  it('refuses a text burn when this ffmpeg cannot draw subtitles', () => {
    expect(() => plan(nightTrainInfo(), with_({ subtitles: { burn: 3 } }), machine(['subtitles']))).toThrow(
      'Burning text subtitles needs ffmpeg-full. Install it with: brew install ffmpeg-full',
    );
  });
});

describe('plan: re-encoding video', () => {
  it('shrinks a wide 1080p H.264 movie to 1280x534 at CRF 20 slow', () => {
    const p = plan(makeInfo({ video: { index: 0, codec: 'h264', width: 1920, height: 800, fps: 23.976, bitDepth: 8, hdr: 'sdr', rotation: 0 } }), at(720));
    expect(out(p)).toEqual(
      expect.arrayContaining(['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-vf', 'scale=1280:534:flags=lanczos']),
    );
    expect(p.summary[0]).toBe('Video: shrunk to 1280x534, re-encoded, looks the same, no bigger than the original');
    expect(p.expect.video).toEqual({ width: 1280, height: 534 });
    expect(p.tracks[0]).toEqual({ source: 0, kind: 'video', action: 'encode', why: 'Shrinking the picture needs a re-encode' });
  });

  it('re-encodes when Smaller is picked even at the original size', () => {
    const p = plan(nightTrainInfo(), at('original', 70));
    expect(out(p)).toEqual(expect.arrayContaining(['-preset', 'medium', '-crf', '28']));
    expect(p.summary[0]).toBe('Video: re-encoded as HEVC, slight softening');
  });

  it('re-encodes video MP4 cannot hold', () => {
    const vp9 = makeInfo({ video: { index: 0, codec: 'vp9', width: 1280, height: 720, fps: 30, bitDepth: 8, hdr: 'sdr', rotation: 0 } });
    const p = plan(vp9, DEFAULT_SETTINGS);
    expect(p.tracks[0].why).toBe('MP4 cannot hold VP9');
    expect(out(p)).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
  });

  it('sizes a portrait phone video by its on-screen shape, in a box turned upright', () => {
    const phone = makeInfo({ video: { index: 0, codec: 'hevc', width: 1920, height: 1080, fps: 30, bitDepth: 8, hdr: 'sdr', rotation: 90 } });
    const p = plan(phone, at(720));
    expect(out(p)).toContain('scale=720:1280:flags=lanczos');
    expect(p.expect.video).toEqual({ width: 720, height: 1280 });
    expect(p.summary[0]).toBe('Video: shrunk to 720x1280, re-encoded as HEVC, looks the same, no bigger than the original');
    expect(plan(phone, at(1080)).summary[0]).toBe('Video: copied, no quality loss');
  });

  it('rounds an odd-sized picture down to even when re-encoding', () => {
    const odd = makeInfo({ video: { index: 0, codec: 'vp9', width: 641, height: 361, fps: 30, bitDepth: 8, hdr: 'sdr', rotation: 0 } });
    const p = plan(odd, DEFAULT_SETTINGS);
    expect(out(p)).toContain('scale=640:360:flags=lanczos');
    expect(p.expect.video).toEqual({ width: 640, height: 360 });
    expect(p.summary[0]).toBe('Video: re-encoded, looks the same, no bigger than the original');
  });

  it('lowers the frame rate before scaling', () => {
    const fast = makeInfo({ video: { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 59.94, bitDepth: 8, hdr: 'sdr', rotation: 0 } });
    const p = plan(fast, with_({ size: 720, fps: 30 }));
    expect(out(p)).toContain('fps=30,scale=1280:720:flags=lanczos');
    expect(p.summary[0]).toBe('Video: shrunk to 1280x720, 59.94 fps to 30 fps, re-encoded, looks the same, no bigger than the original');
  });

  it('ignores a frame rate that is not lower than the source', () => {
    expect(plan(nightTrainInfo(), with_({ fps: 30 })).summary[0]).toBe('Video: copied, no quality loss');
  });

  it('encodes HEVC at the source colour depth, and copies when HEVC is already there', () => {
    expect(plan(nightTrainInfo(), with_({ video: { codec: 'hevc' } })).summary[0]).toBe('Video: copied, no quality loss');
    const p = plan(nightTrainInfo(), with_({ video: { codec: 'hevc', rate: { mode: 'quality', quality: 70 } } }));
    expect(out(p)).toEqual(expect.arrayContaining(['-c:v', 'libx265', '-crf', '28', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1']));
    expect(p.summary[0]).toBe('Video: re-encoded as HEVC, slight softening');
  });

  it('encodes AV1 with SVT-AV1', () => {
    expect(out(plan(makeInfo(), with_({ size: 720, video: { codec: 'av1' } })))).toEqual(
      expect.arrayContaining(['-c:v', 'libsvtav1', '-preset', '6', '-crf', '30']),
    );
  });

  it('uses the Mac hardware encoder in fast mode, and says so when there is none', () => {
    expect(out(plan(makeInfo(), with_({ size: 720, video: { speed: 'fast' } })))).toEqual(expect.arrayContaining(['-c:v', 'hevc_videotoolbox']));
    const noHw = plan(makeInfo(), with_({ size: 720, video: { speed: 'fast' } }), machine(['h264_videotoolbox', 'hevc_videotoolbox']));
    expect(out(noHw)).toEqual(expect.arrayContaining(['-c:v', 'libx265']));
    expect(noHw.warnings).toContain('Fast is not available on this computer, so Balanced is used.');
  });

  it('keeps HDR10 by re-encoding to 10-bit HEVC with its colour and mastering data', () => {
    const hdr = makeInfo({
      video: {
        index: 0, codec: 'hevc', width: 3840, height: 2160, fps: 24, bitDepth: 10, hdr: 'hdr10', rotation: 0,
        hdrMeta: { masterDisplay: 'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50)', maxCll: '1000,400' },
      },
    });
    const o = out(plan(hdr, at(1080)));
    expect(o).toEqual(expect.arrayContaining(['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc']));
    expect(o[o.indexOf('-x265-params') + 1]).toBe(
      'hdr10=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50):max-cll=1000,400',
    );
    expect(plan(hdr, at(1080)).warnings).toEqual([]);
  });

  it('warns before squashing HDR into H.264', () => {
    const hdr = makeInfo({ video: { index: 0, codec: 'hevc', width: 3840, height: 2160, fps: 24, bitDepth: 10, hdr: 'hdr10', rotation: 0 } });
    expect(plan(hdr, with_({ size: 1080, video: { codec: 'h264' } })).warnings).toEqual([
      'This video is HDR. Re-encoding it to standard H.264 makes the colours look washed out.',
    ]);
  });
});

describe('plan: never bigger than the original', () => {
  it('keeps HEVC when burning subtitles into an HEVC movie, capped at its own bitrate', () => {
    const p = plan(nightTrainInfo(), with_({ subtitles: { burn: 3 } }));
    expect(out(p)).toEqual(
      expect.arrayContaining(['-c:v', 'libx265', '-crf', '22', '-maxrate', '732k', '-bufsize', '1464k', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1']),
    );
    expect(p.summary[0]).toBe('Video: re-encoded as HEVC, looks the same, no bigger than the original');
  });

  it('keeps H.264 for an H.264 movie, working out its bitrate from the file size when the file does not say', () => {
    // 510 MB over 2 h 3 min is 550 kbps in all, less 128 kbps guessed for each of the two stereo tracks.
    expect(out(plan(blueHarbourInfo(), with_({ subtitles: { burn: 3 } })))).toEqual(
      expect.arrayContaining(['-c:v', 'libx264', '-crf', '20', '-maxrate', '294k', '-bufsize', '588k']),
    );
  });

  it('caps lower slider positions at a shrinking share of the original bitrate, a fifth at the far left', () => {
    expect(out(plan(nightTrainInfo(), at('original', 70)))).toEqual(expect.arrayContaining(['-crf', '28', '-maxrate', '556k']));
    expect(out(plan(nightTrainInfo(), at('original', 40)))).toEqual(expect.arrayContaining(['-crf', '34', '-maxrate', '380k']));
    expect(out(plan(nightTrainInfo(), at('original', 0)))).toEqual(expect.arrayContaining(['-crf', '42', '-maxrate', '146k']));
  });

  it('names each stretch of the slider in plain words', () => {
    const words = [100, 85, 60, 35, 10].map((q) => plan(nightTrainInfo(), at(480, q)).summary[0].split(', re-encoded as HEVC, ')[1]);
    expect(words).toEqual(['looks the same, no bigger than the original', 'nearly the same', 'slight softening', 'visibly softer', 'very soft']);
  });

  it('aims fast mode at the original bitrate, with a ceiling for a heavy source', () => {
    expect(out(plan(nightTrainInfo(), with_({ subtitles: { burn: 3 }, video: { speed: 'fast' } })))).toEqual(
      expect.arrayContaining(['-c:v', 'hevc_videotoolbox', '-b:v', '732k']),
    );
    const remux = makeInfo({
      sizeBytes: 30e9,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 24, bitDepth: 8, hdr: 'sdr', rotation: 0, bitRate: 30e6 },
    });
    // 1280x720 at 24 fps and 0.15 bits a pixel for H.264.
    expect(out(plan(remux, with_({ size: 720, video: { speed: 'fast' } })))).toEqual(expect.arrayContaining(['-c:v', 'h264_videotoolbox', '-b:v', '3317k']));
  });

  it('leaves the quality uncapped when the original bitrate cannot be known', () => {
    const unknown = makeInfo({ durationSec: 0 });
    expect(out(plan(unknown, at(720)))).not.toContain('-maxrate');
    expect(out(plan(unknown, with_({ size: 720, video: { speed: 'fast' } })))).toEqual(expect.arrayContaining(['-c:v', 'hevc_videotoolbox', '-q:v', '65']));
    expect(plan(unknown, at(720)).summary[0]).toBe('Video: shrunk to 1280x534, re-encoded as HEVC, looks the same');
  });
});

describe('plan: speed', () => {
  const smallest = (info: ReturnType<typeof nightTrainInfo>, changes: Patch = {}) => plan(info, with_({ ...changes, subtitles: { burn: 3 }, video: { speed: 'smallest' } }));

  it('makes the smallest HEVC with x265 slow three CRF steps up, the same look at about 20 percent less', () => {
    const p = smallest(nightTrainInfo());
    expect(out(p)).toEqual(expect.arrayContaining(['-c:v', 'libx265', '-preset', 'slow', '-crf', '25', '-maxrate', '732k']));
    expect(p.summary[0]).toBe('Video: re-encoded as HEVC (slow, smallest file), looks the same, no bigger than the original');
  });

  it('makes the smallest H.264 with x264 veryslow one CRF step up', () => {
    expect(out(smallest(blueHarbourInfo()))).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '21']));
  });

  it('runs SVT-AV1 at preset 6, and 4 for the smallest file', () => {
    const av1 = (speed: 'balanced' | 'smallest') => out(plan(nightTrainInfo(), with_({ video: { codec: 'av1', speed } })));
    expect(av1('balanced')).toEqual(expect.arrayContaining(['-preset', '6', '-crf', '30']));
    expect(av1('smallest')).toEqual(expect.arrayContaining(['-preset', '4', '-crf', '30']));
  });

  it('falls back to Balanced when Fast has no hardware encoder for the codec', () => {
    const p = plan(nightTrainInfo(), with_({ video: { codec: 'av1', speed: 'fast' } }));
    expect(out(p)).toEqual(expect.arrayContaining(['-c:v', 'libsvtav1', '-preset', '6']));
    expect(p.warnings).toContain('Fast is not available for AV1, so Balanced is used.');
  });
});

describe('plan: rate', () => {
  const movie = () =>
    makeInfo({
      video: { index: 0, codec: 'h264', width: 1920, height: 800, fps: 23.976, bitDepth: 8, hdr: 'sdr', rotation: 0 },
      audio: [
        { index: 1, codec: 'aac', channels: 6, language: 'hin', bitRate: 384000 },
        { index: 2, codec: 'aac', channels: 6, language: 'eng', bitRate: 384000 },
      ],
      subtitles: [],
    });

  it('aims for a target size in two passes', () => {
    const p = plan(movie(), with_({ video: { rate: { mode: 'target', bytes: 2e9 } } }));
    expect(p.steps.map((s) => s.kind)).toEqual(['first-pass', 'encode']);
    expect(p.steps[0].output).toEqual(expect.arrayContaining(['-b:v', '1339k', '-pass', '1', '-an', '-sn']));
    expect(p.steps[0].to).toBe('null');
    expect(out(p)).toEqual(expect.arrayContaining(['-b:v', '1339k', '-pass', '2']));
    expect(p.summary[0]).toBe('Video: re-encoded, aiming for 2.0 GB');
  });

  it('exposes the video arguments alone for samples and previews, without pass flags', () => {
    const p = plan(movie(), with_({ video: { rate: { mode: 'target', bytes: 2e9 } } }));
    expect(p.videoArgs).toEqual(expect.arrayContaining(['-map', '0:0', '-c:v', 'libx264', '-b:v', '1339k']));
    expect(p.videoArgs).not.toContain('-pass');
    expect(plan(nightTrainInfo(), DEFAULT_SETTINGS).videoArgs).toBeNull();
  });

  it('guesses 64 kbps per channel for copied audio whose bitrate the file does not give', () => {
    const quiet = makeInfo({ audio: [{ index: 1, codec: 'aac', channels: 2, language: 'eng' }], subtitles: [] });
    const p = plan(quiet, with_({ video: { rate: { mode: 'target', bytes: 1e9 } } }));
    expect(out(p)).toEqual(expect.arrayContaining(['-b:v', '925k']));
  });

  it('says how small a target can be', () => {
    expect(() => plan(movie(), with_({ video: { rate: { mode: 'target', bytes: 100e6 } } }))).toThrow(
      'That size is too small for this length. It needs at least 824 MB.',
    );
  });

  it('holds a fixed bitrate', () => {
    expect(out(plan(movie(), with_({ video: { rate: { mode: 'bitrate', kbps: 5000 } } })))).toEqual(
      expect.arrayContaining(['-b:v', '5000k', '-maxrate', '5000k', '-bufsize', '10000k']),
    );
  });
});

describe('plan: formats', () => {
  it('keeps every track in MKV, image subtitles included', () => {
    const p = plan(blueHarbourInfo(), with_({ format: 'mkv' }));
    expect(p.ext).toBe('mkv');
    expect(out(p)).toEqual(expect.arrayContaining(['-map', '0:3', '-c:s:0', 'copy', '-map', '0:4', '-c:s:1', 'copy']));
    expect(out(p)).not.toContain('-movflags');
    expect(p.expect.subtitleTracks).toBe(2);
  });

  it('re-encodes to VP9 and Opus for WebM, with WebVTT subtitles', () => {
    const p = plan(nightTrainInfo(), with_({ format: 'webm' }));
    expect(p.ext).toBe('webm');
    expect(out(p)).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '732k', '-c:a:0', 'libopus', '-c:s:0', 'webvtt']));
  });

  it('copies into MOV', () => {
    const p = plan(nightTrainInfo(), with_({ format: 'mov' }));
    expect(p.ext).toBe('mov');
    expect(p.summary[0]).toBe('Video: copied, no quality loss');
  });

  it('takes only the track that plays first for MP3', () => {
    const p = plan(nightTrainInfo(), with_({ format: 'mp3', audio: { first: 2 } }));
    expect(p.ext).toBe('mp3');
    expect(out(p)).toEqual(['-vn', '-sn', '-map', '0:2', '-c:a:0', 'libmp3lame', '-q:a', '2']);
    expect(p.expect).toMatchObject({ audioTracks: 1, subtitleTracks: 0, video: null });
    expect(p.summary).toEqual(['Video: left out (audio only)', 'Audio: English 5.1 converted to MP3']);
  });

  it('copies AAC into M4A', () => {
    const p = plan(nightTrainInfo(), with_({ format: 'm4a' }));
    expect(out(p)).toEqual(['-vn', '-sn', '-map', '0:1', '-c:a:0', 'copy', '-movflags', '+faststart']);
  });
});

describe('plan: audio', () => {
  it('converts audio MP4 cannot hold to AAC with a safe channel layout', () => {
    const p = plan(makeInfo({ audio: [{ index: 1, codec: 'flac', channels: 6, language: 'eng' }] }), DEFAULT_SETTINGS);
    expect(out(p)).toEqual(
      expect.arrayContaining(['-c:a:0', 'aac', '-b:a:0', '384k', '-filter:a:0', 'aformat=channel_layouts=mono|stereo|3.0|4.0|5.0|5.1|7.1']),
    );
    expect(p.summary[1]).toBe('Audio: English 5.1 converted to AAC');
  });

  it('measures, then sets loudness to the streaming target', () => {
    const p = plan(nightTrainInfo(), with_({ audio: { loudness: 'streaming' } }));
    expect(p.steps.map((s) => s.kind)).toEqual(['measure-loudness', 'measure-loudness', 'encode']);
    expect(p.steps[0]).toEqual({
      kind: 'measure-loudness',
      input: ['-i', '/m/Night Train.mkv'],
      output: ['-map', '0:1', '-vn', '-sn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json'],
      to: 'null',
      audio: '1',
    });
    expect(out(p)).toEqual(expect.arrayContaining(['-c:a:0', 'aac', '-b:a:0', '384k', '-filter:a:0', '{loudnorm:1}']));
    expect(p.summary[1]).toBe('Audio: Hindi 5.1 and English 5.1 set to -14 LUFS for streaming');
  });

  it('adds a stereo track made from the 5.1, measured on its own when loudness is set', () => {
    const plain = plan(nightTrainInfo(), with_({ audio: { addStereo: true } }));
    expect(out(plain)).toEqual(
      expect.arrayContaining(['-map', '0:1', '-c:a:2', 'aac', '-b:a:2', '192k', '-ac:a:2', '2', '-metadata:s:a:2', 'title=Stereo']),
    );
    expect(plain.expect.audioTracks).toBe(3);
    expect(plain.summary[1]).toBe('Audio: Hindi 5.1 and English 5.1 copied; stereo track added from Hindi 5.1');

    const loud = plan(nightTrainInfo(), with_({ audio: { addStereo: true, loudness: 'eu-tv' } }));
    const stereoMeasure = loud.steps.find((s) => s.audio === '1:stereo')!;
    expect(stereoMeasure.output).toEqual(['-map', '0:1', '-vn', '-sn', '-ac', '2', '-af', 'loudnorm=I=-23:TP=-1:LRA=11:print_format=json']);
    expect(out(loud)).toEqual(expect.arrayContaining(['-filter:a:2', '{loudnorm:1:stereo}']));
  });
});

describe('plan: what the file is', () => {
  it('plans an audio-only file without a video track', () => {
    const p = plan(makeInfo({ video: null, subtitles: [] }), DEFAULT_SETTINGS);
    expect(out(p)).not.toContain('-c:v');
    expect(p.expect.video).toBeNull();
  });

  it('refuses a file with no video and no sound', () => {
    expect(() => plan(makeInfo({ video: null, audio: [] }), DEFAULT_SETTINGS)).toThrow(PlanError);
    expect(() => plan(makeInfo({ video: null, audio: [] }), DEFAULT_SETTINGS)).toThrow('This file has no video or sound to convert');
  });

  it('checks the length against the longest kept track, not a subtitle that runs longer', () => {
    const info = makeInfo({
      durationSec: 9,
      video: { index: 0, codec: 'h264', width: 1280, height: 720, fps: 24, bitDepth: 8, hdr: 'sdr', rotation: 0, durationSec: 3 },
      audio: [{ index: 1, codec: 'aac', channels: 2, language: 'eng', durationSec: 3.02 }],
    });
    expect(plan(info, DEFAULT_SETTINGS).expect.durationSec).toBe(3.02);
  });

  it('falls back to the file length when no kept track says how long it is', () => {
    expect(plan(makeInfo({ durationSec: 7440 }), DEFAULT_SETTINGS).expect.durationSec).toBe(7440);
  });

  it('refuses a photo, since a one-frame MP4 helps no one', () => {
    const photo = makeInfo({ container: 'image2', durationSec: 0.04, audio: [], subtitles: [] });
    expect(() => plan(photo, DEFAULT_SETTINGS)).toThrow('This is a picture, not a video.');
    expect(() => plan({ ...photo, container: 'png_pipe' }, DEFAULT_SETTINGS)).toThrow(PlanError);
  });

  it('still converts an animated GIF', () => {
    expect(plan(makeInfo({ container: 'gif', audio: [], subtitles: [] }), DEFAULT_SETTINGS).ext).toBe('mp4');
  });

  it('warns when the length is unknown', () => {
    expect(plan(makeInfo({ durationSec: 0 }), DEFAULT_SETTINGS).warnings).toEqual([
      'This file does not say how long it is, so progress and the length check are skipped.',
    ]);
  });
});
