import { burnChoices } from '../engine/choices';
import { FORMATS } from '../engine/formats';
import type { FileInfo, Machine, Settings } from '../engine/types';
import { codecName, languageName, layoutName } from '../engine/words';
import { Checkbox } from './Checkbox';
import { Dropdown } from './Dropdown';

interface TracksPanelProps {
  info: FileInfo;
  settings: Settings;
  machine: Machine;
  onChange(settings: Settings): void;
}

/** Audio and subtitle tracks: which to keep, which plays first, and what to do with subtitles. */
export function TracksPanel({ info, settings, machine, onChange }: TracksPanelProps) {
  const format = FORMATS[settings.format];
  const keptAudio = settings.audio.keep === 'all' ? info.audio.map((a) => a.index) : settings.audio.keep;
  const tickedSubs = settings.subtitles.keep === 'auto' ? info.subtitles.map((s) => s.index) : settings.subtitles.keep;
  const burnable = burnChoices(info, machine).filter((c) => !c.disabled);
  const kept = info.audio.filter((a) => keptAudio.includes(a.index));
  const first = kept.find((a) => a.index === settings.audio.first) ?? kept[0];

  const update = (change: (s: Settings) => void) => {
    const next = structuredClone(settings);
    change(next);
    onChange(next);
  };
  const toggle = (list: number[], index: number, on: boolean) => (on ? [...list, index].sort((a, b) => a - b) : list.filter((i) => i !== index));

  return (
    <div className="grid grid-cols-2 gap-8">
      <div className="grid content-start gap-2.5">
        <h2 className="font-semibold">Audio</h2>
        {info.audio.length === 0 && <span className="text-muted">None in this file</span>}
        {info.audio.map((a) => {
          const label = `${languageName(a.language)} · ${codecName(a.codec)} ${layoutName(a.channels)}`;
          const isKept = keptAudio.includes(a.index);
          const firstTag =
            kept.length < 2 || !isKept ? null : a === first ? (
              <span className="rounded-full bg-well px-2 py-0.5 text-xs text-muted">Plays first</span>
            ) : (
              <button
                type="button"
                aria-label={`Play ${languageName(a.language)} first`}
                onClick={() => update((s) => void (s.audio.first = a.index))}
                className="rounded-full px-2 py-0.5 text-xs font-semibold text-muted hover:bg-well focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Play first
              </button>
            );
          return (
            <Checkbox
              key={a.index}
              label={label}
              checked={isKept}
              after={firstTag}
              onChange={(on) => update((s) => void (s.audio.keep = toggle(keptAudio, a.index, on)))}
            />
          );
        })}
      </div>

      <div className="grid content-start gap-2.5">
        <h2 className="font-semibold">Subtitles</h2>
        {info.subtitles.length === 0 && <span className="text-muted">None in this file</span>}
        {info.subtitles.map((sub) => {
          const noRoom = format.audioOnly ? ' (not kept in audio only)' : sub.kind === 'image' && !format.imageSubtitles ? ' (burn in or choose MKV)' : '';
          const burned = settings.subtitles.burn === sub.index;
          return (
            <Checkbox
              key={sub.index}
              label={`${languageName(sub.language)} · ${sub.kind}${burned ? ' (burned in)' : noRoom}`}
              checked={!noRoom && !burned && tickedSubs.includes(sub.index)}
              disabled={!!noRoom || burned}
              onChange={(on) => update((s) => void (s.subtitles.keep = toggle(tickedSubs, sub.index, on)))}
            />
          );
        })}
        {info.subtitles.length > 0 && !format.audioOnly && (
          <>
            <Checkbox
              label="Also save as .srt"
              checked={settings.subtitles.saveSrt}
              disabled={!info.subtitles.some((s) => s.kind === 'text')}
              onChange={(on) => update((s) => void (s.subtitles.saveSrt = on))}
            />
            <Checkbox
              label="Burn into the picture (re-encodes the video)"
              checked={settings.subtitles.burn !== null}
              disabled={!info.video || burnable.length === 0}
              onChange={(on) => update((s) => void (s.subtitles.burn = on ? Number(burnable[0].value) : null))}
            />
            {settings.subtitles.burn !== null && info.subtitles.length > 1 && (
              <Dropdown
                id="burn-track"
                label="Which subtitles"
                value={String(settings.subtitles.burn)}
                options={burnChoices(info, machine)}
                onChange={(value) => update((s) => void (s.subtitles.burn = Number(value)))}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
