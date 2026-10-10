/**
 * Turns ffprobe and ffmpeg messages into plain words and a next step. The raw line
 * always stays in the item's log, where Show details displays it.
 */
const READ_ERRORS: [RegExp, string][] = [
  [/Is a directory/i, 'This is a folder. Drop the video files inside it instead.'],
  [/No such file/i, 'This file is no longer there. It may have been moved or deleted.'],
  [/Permission denied|Operation not permitted/i, 'Mediamorph is not allowed to read this file. Check its permissions in Finder.'],
  [/Invalid data found|Not a video or audio file|could not find codec parameters/i, 'This is not a video or audio file Mediamorph can read.'],
];

const RUN_ERRORS: [RegExp, string][] = [
  [/No space left on device/i, 'The disk is full. Free up some space, then try again.'],
  [/Permission denied|Operation not permitted|Read-only file system/i, 'Mediamorph cannot write next to this file. Move it to a folder you can write to, then try again.'],
  [/No such file/i, 'The file went missing while converting. It may have been moved or deleted.'],
];

export function explainReadError(raw: string): string {
  return READ_ERRORS.find(([pattern]) => pattern.test(raw))?.[1] ?? 'Mediamorph could not read this file.';
}

export function explainRunError(raw: string): string {
  return RUN_ERRORS.find(([pattern]) => pattern.test(raw))?.[1] ?? 'ffmpeg stopped with an error. Show details has its message.';
}
