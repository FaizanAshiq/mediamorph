import { useRef, useState } from 'react';
import { useConvert } from '../store';
import { useFileUrl } from './useFileUrl';

/**
 * 10 seconds of the original and the same 10 seconds with these settings, playing together, one over the other, with
 * a line to drag between them. Picture only. The box takes the video's own shape, so a wide film has no black bands.
 */
export function PreviewDialog() {
  const preview = useConvert((s) => s.preview);
  const close = useConvert((s) => s.closePreview);
  const ready = preview?.status === 'ready' ? preview : null;
  const before = useFileUrl(ready?.before);
  const after = useFileUrl(ready?.after);
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const [cut, setCut] = useState(50);
  const [playing, setPlaying] = useState(true);
  if (!preview) return null;

  const videos = () => [beforeRef.current, afterRef.current].filter((v): v is HTMLVideoElement => v !== null);
  const toggle = () => {
    for (const video of videos()) {
      if (playing) video.pause();
      else void video.play()?.catch(() => undefined);
    }
    setPlaying(!playing);
  };
  /** The two clips start together; this pulls the second back if it drifts more than a few frames. */
  const keepTogether = () => {
    const [a, b] = [beforeRef.current, afterRef.current];
    if (a && b && Math.abs(a.currentTime - b.currentTime) > 0.15) b.currentTime = a.currentTime;
  };

  return (
    <dialog open aria-label="Preview 10 s" className="fixed inset-0 z-10 m-auto grid w-[min(960px,92vw)] gap-4 rounded bg-surface p-5 text-ink shadow-2xl">
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold">Preview 10 s</h2>
        <p className="text-muted">10 seconds from a third of the way in, picture only. Drag the line to compare.</p>
      </div>
      {preview.status === 'working' && <p className="text-muted">Encoding 10 seconds with these settings…</p>}
      {preview.status === 'none' && <p className="text-muted">Nothing to preview: the video is copied as it is.</p>}
      {ready && before && after && (
        <>
          <div className="relative w-full overflow-hidden rounded bg-black" style={{ aspectRatio: `${ready.width} / ${ready.height}` }}>
            <video
              ref={beforeRef}
              src={before}
              aria-label="Original, 10 seconds"
              autoPlay
              muted
              loop
              playsInline
              onTimeUpdate={keepTogether}
              className="absolute inset-0 h-full w-full object-contain"
            />
            <video
              ref={afterRef}
              src={after}
              aria-label="These settings, 10 seconds"
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${cut}%)` }}
            />
            <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${cut}%` }} />
            <span className="absolute left-2.5 top-2.5 rounded-full bg-black/65 px-2.5 py-0.5 text-xs font-semibold text-white">Original</span>
            <span className="absolute right-2.5 top-2.5 rounded-full bg-black/65 px-2.5 py-0.5 text-xs font-semibold text-white">These settings</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggle}
              className="h-7 w-20 shrink-0 rounded-full bg-well font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={cut}
              aria-label="Move the comparison line"
              onChange={(e) => setCut(Number(e.target.value))}
              className="w-full accent-check"
            />
          </div>
        </>
      )}
      <button
        type="button"
        onClick={close}
        className="h-7 justify-self-end rounded-full bg-well px-3.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Close
      </button>
    </dialog>
  );
}
