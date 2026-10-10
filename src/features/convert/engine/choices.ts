import { HARDWARE_ENCODER, smallestGain } from './codecs';
import { FORMATS } from './formats';
import { encodeCodec } from './planner';
import type { FileInfo, Format, Machine, Settings, VideoTrack } from './types';
import { codecName, languageName } from './words';

export interface Choice {
  value: string;
  label: string;
  disabled: boolean;
}

const FPS_STEPS = [60, 50, 30, 25, 24];

export function videoCodecChoices(format: Format): Choice[] {
  const codecs = FORMATS[format].videoCodecs;
  return [{ value: 'auto', label: 'Copy when possible', disabled: false }, ...codecs.map((c) => ({ value: c, label: codecName(c), disabled: false }))];
}

export function fpsChoices(video: VideoTrack): Choice[] {
  return [
    { value: 'same', label: `Same (${video.fps})`, disabled: false },
    ...FPS_STEPS.map((fps) => {
      const lower = fps < video.fps - 0.01;
      return { value: String(fps), label: lower ? `${fps} fps` : `${fps} fps (not lower than the original)`, disabled: !lower };
    }),
  ];
}

export interface SpeedChoice extends Choice {
  /** What picking it means, in a sentence. */
  note: string;
}

/** Fast, Balanced and Smallest file, each with what it costs; Fast is greyed out without a hardware encoder. */
export function speedChoices(settings: Settings, info: FileInfo, machine: Machine): SpeedChoice[] {
  const format = FORMATS[settings.format];
  if (!info.video || format.audioOnly) {
    const note = 'Speed is not used without a picture.';
    return [
      { value: 'fast', label: 'Fast', disabled: true, note },
      { value: 'balanced', label: 'Balanced', disabled: true, note },
      { value: 'smallest', label: 'Smallest file', disabled: true, note },
    ];
  }
  const codec = encodeCodec(settings, format, info.video);
  const hardware = HARDWARE_ENCODER[codec];
  const noFast = !hardware
      ? `There is no hardware encoder for ${codecName(codec)}.`
      : !machine.encoders.has(hardware)
        ? 'This computer has no hardware encoder.'
        : null;
  const { smaller, slower } = smallestGain(codec);
  return [
    { value: 'fast', label: 'Fast', disabled: noFast !== null, note: noFast ?? 'The video hardware in the Mac: several times quicker, a little softer at the same size.' },
    { value: 'balanced', label: 'Balanced', disabled: false, note: 'The usual trade between size and time.' },
    {
      value: 'smallest',
      label: 'Smallest file',
      disabled: false,
      note: `About ${Math.round(smaller * 100)} percent smaller at the same look; takes about ${Math.round(slower * 10) / 10} times as long.`,
    },
  ];
}

export function burnChoices(info: FileInfo, machine: Machine): Choice[] {
  return info.subtitles.map((s) => {
    const canDraw = s.kind === 'image' || machine.filters.has('subtitles');
    const reason = canDraw ? '' : ', needs ffmpeg-full: brew install ffmpeg-full';
    return { value: String(s.index), label: `${languageName(s.language)} (${s.kind}${reason})`, disabled: !canDraw };
  });
}
