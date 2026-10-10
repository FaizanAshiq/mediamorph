import type { Size, VideoTrack } from './types';

export const SIZES = [2160, 1080, 720, 480] as const;

export interface SizeChoice {
  value: Size;
  label: string;
  disabled: boolean;
}

export function evenRound(n: number): number {
  return 2 * Math.round(n / 2);
}

/** The picture as the player shows it: a quarter turn swaps width and height. */
export function displaySize(video: Pick<VideoTrack, 'width' | 'height' | 'rotation'>): { width: number; height: number } {
  const quarterTurn = video.rotation === 90 || video.rotation === 270;
  return quarterTurn ? { width: video.height, height: video.width } : { width: video.width, height: video.height };
}

/** H.264 in 4:2:0 needs even sides, so an odd side loses one pixel. */
export function evenFloor(n: number): number {
  return n - (n % 2);
}

/**
 * The largest size that fits a 16:9 box of this height, keeping the shape. Null when the video already fits.
 * The box turns with the picture, so a portrait 1080x1920 phone video counts as 1080p, like it does everywhere else.
 */
export function fitInBox(width: number, height: number, size: Size): { width: number; height: number } | null {
  if (size === 'original') return null;
  const long = evenRound((size * 16) / 9);
  const box = height > width ? { width: size, height: long } : { width: long, height: size };
  if (width <= box.width && height <= box.height) return null;
  const scale = Math.min(box.width / width, box.height / height);
  return { width: evenRound(width * scale), height: evenRound(height * scale) };
}

export function sizeChoices(video: Pick<VideoTrack, 'width' | 'height'> | null): SizeChoice[] {
  if (!video) return [{ value: 'original', label: 'Original', disabled: false }];
  const smaller = SIZES.map((size): SizeChoice => {
    const name = size === 2160 ? '4K' : `${size}p`;
    const fit = fitInBox(video.width, video.height, size);
    if (!fit) return { value: size, label: `${name} (not smaller than the original)`, disabled: true };
    return { value: size, label: `${name} (${fit.width}x${fit.height})`, disabled: false };
  });
  return [{ value: 'original', label: `Original (${video.width}x${video.height})`, disabled: false }, ...smaller];
}
