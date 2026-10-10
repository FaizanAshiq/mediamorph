import { useState } from 'react';
import { FORMATS } from '../engine/formats';
import { LOUDNESS_TARGETS } from '../engine/loudness';
import type { FileInfo, Loudness, Settings } from '../engine/types';
import { Checkbox } from './Checkbox';
import { Dropdown } from './Dropdown';

interface AdvancedPanelProps {
  info: FileInfo;
  settings: Settings;
  onChange(settings: Settings): void;
  onSavePreset(name: string): Promise<void>;
}

const LOUDNESS_OPTIONS = [
  { value: 'off', label: 'Off' },
  ...(Object.keys(LOUDNESS_TARGETS) as Exclude<Loudness, 'off'>[]).map((key) => ({ value: key, label: LOUDNESS_TARGETS[key].label })),
];

/** Delivery work: loudness, a stereo track, and saving all of this as a preset. */
export function AdvancedPanel({ info, settings, onChange, onSavePreset }: AdvancedPanelProps) {
  const [presetName, setPresetName] = useState('');
  const [saved, setSaved] = useState(false);
  const surround = info.audio.some((a) => a.channels >= 6);
  const update = (change: (s: Settings) => void) => {
    const next = structuredClone(settings);
    change(next);
    onChange(next);
  };

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
      <Dropdown
        id="loudness"
        label="Loudness"
        value={settings.audio.loudness}
        options={LOUDNESS_OPTIONS}
        disabled={info.audio.length === 0}
        onChange={(value) => update((s) => void (s.audio.loudness = value as Loudness))}
      />
      <div className="grid content-start gap-1.5">
        <span className="text-muted">Audio layout</span>
        <Checkbox
          label="Add a stereo track made from the 5.1"
          checked={settings.audio.addStereo}
          disabled={!surround || FORMATS[settings.format].audioOnly}
          onChange={(on) => update((s) => void (s.audio.addStereo = on))}
        />
      </div>
      <div className="col-span-2 grid content-start gap-1.5">
        <label htmlFor="preset-name" className="text-muted">
          Save these settings as a preset
        </label>
        <div className="flex gap-2">
          <input
            id="preset-name"
            value={presetName}
            placeholder="Preset name"
            onChange={(e) => {
              setPresetName(e.target.value);
              setSaved(false);
            }}
            className="h-7 w-60 rounded bg-well px-2.5 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            type="button"
            disabled={!presetName.trim()}
            onClick={() => void onSavePreset(presetName).then(() => setSaved(true))}
            className="h-7 rounded-full bg-well px-3.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
          >
            Save
          </button>
          {saved && <span className="self-center text-good">Saved</span>}
        </div>
      </div>
    </div>
  );
}
