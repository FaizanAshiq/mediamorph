import { useState } from 'react';
import { fpsChoices, videoCodecChoices } from '../engine/choices';
import { FORMATS } from '../engine/formats';
import type { FileInfo, Settings, VideoCodec } from '../engine/types';
import { Dropdown } from './Dropdown';

interface PanelProps {
  info: FileInfo;
  settings: Settings;
  /** The video bitrate the slider was heading for, to start Fixed bitrate from. */
  suggestedKbps: number | null;
  onChange(settings: Settings): void;
}

/** Codec, colour depth, frame rate, and how the size is decided. */
export function PicturePanel({ info, settings, suggestedKbps, onChange }: PanelProps) {
  const noVideo = !info.video || FORMATS[settings.format].audioOnly;
  const rate = settings.video.rate;
  const [amount, setAmount] = useState(() => (rate.mode === 'target' ? String(rate.bytes / 1e9) : rate.mode === 'bitrate' ? String(rate.kbps) : ''));

  const update = (change: (s: Settings) => void) => {
    const next = structuredClone(settings);
    change(next);
    onChange(next);
  };

  const setMode = (mode: string) => {
    if (mode === 'target') {
      setAmount('2');
      update((s) => void (s.video.rate = { mode: 'target', bytes: 2e9 }));
    } else if (mode === 'bitrate') {
      const kbps = suggestedKbps ? Math.max(100, Math.round(suggestedKbps / 10) * 10) : 5000;
      setAmount(String(kbps));
      update((s) => void (s.video.rate = { mode: 'bitrate', kbps }));
    } else {
      update((s) => void (s.video.rate = { mode: 'quality', quality: 100 }));
    }
  };

  const setNumber = (text: string) => {
    setAmount(text);
    const n = parseFloat(text);
    if (!Number.isFinite(n) || n <= 0) return;
    update((s) => void (s.video.rate = rate.mode === 'target' ? { mode: 'target', bytes: Math.round(n * 1e9) } : { mode: 'bitrate', kbps: Math.round(n) }));
  };

  if (noVideo) return <p className="text-muted">There is no picture to change in {FORMATS[settings.format].audioOnly ? 'audio only' : 'this file'}.</p>;
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
      <Dropdown
        id="video-codec"
        label="Video codec"
        value={settings.video.codec}
        options={videoCodecChoices(settings.format)}
        onChange={(value) => update((s) => void (s.video.codec = value as VideoCodec))}
      />
      <Dropdown
        id="colour-depth"
        label="Colour depth"
        value={String(settings.video.bitDepth)}
        options={[
          { value: 'same', label: 'Same as the original' },
          { value: '8', label: '8-bit' },
          { value: '10', label: '10-bit' },
        ]}
        onChange={(value) => update((s) => void (s.video.bitDepth = value === 'same' ? 'same' : (Number(value) as 8 | 10)))}
      />
      {info.video && (
        <Dropdown
          id="frame-rate"
          label="Frame rate"
          value={String(settings.fps)}
          options={fpsChoices(info.video)}
          onChange={(value) => update((s) => void (s.fps = value === 'same' ? 'same' : Number(value)))}
        />
      )}
      <div className="grid content-start gap-2">
        <Dropdown
          id="quality-mode"
          label="Size decided by"
          value={rate.mode}
          options={[
            { value: 'quality', label: 'The quality slider' },
            { value: 'target', label: 'A target size' },
            { value: 'bitrate', label: 'A fixed bitrate' },
          ]}
          onChange={setMode}
        />
        {rate.mode !== 'quality' && (
          <label className="grid gap-1">
            <span className="text-muted">{rate.mode === 'target' ? 'Target size in GB' : 'Bitrate in kbps'}</span>
            <input
              type="number"
              min="0"
              step={rate.mode === 'target' ? '0.1' : '100'}
              value={amount}
              onChange={(e) => setNumber(e.target.value)}
              className="h-7 w-40 rounded bg-well px-2.5 font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
        )}
      </div>
    </div>
  );
}
