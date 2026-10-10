import { useState } from 'react';
import { classes } from '@/lib/classes';
import type { Settings } from '../engine/types';
import { describeFile, statusText } from '../status';
import { useConvert } from '../store';
import { AdvancedPanel } from './AdvancedPanel';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Dropdown } from './Dropdown';
import { PicturePanel } from './PicturePanel';
import { PreviewDialog } from './PreviewDialog';
import { ResultCard } from './ResultCard';
import { TracksPanel } from './TracksPanel';

const TABS = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'picture', label: 'Picture' },
  { id: 'advanced', label: 'Advanced' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** The open file: what it is, what it will become, and the settings that decide it. */
export function FileView() {
  const file = useConvert((s) => s.file);
  const machine = useConvert((s) => s.machine);
  const presets = useConvert((s) => s.presets);
  const presetWarning = useConvert((s) => s.presetWarning);
  const notice = useConvert((s) => s.notice);
  const setSettings = useConvert((s) => s.setSettings);
  const applyPreset = useConvert((s) => s.applyPreset);
  const savePreset = useConvert((s) => s.savePreset);
  const showPreview = useConvert((s) => s.showPreview);
  const editAgain = useConvert((s) => s.editAgain);
  const [tab, setTab] = useState<Tab>('tracks');
  if (!file) return null;

  const editable = file.status === 'ready' || file.status === 'failed' || file.status === 'cancelled';
  const info = file.info;
  const change = (next: Settings) => setSettings(next);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <p aria-live="polite" className="sr-only">
        {statusText(file)}
      </p>
      <div className="mx-auto grid max-w-[960px] gap-5">
        <header className="flex items-end gap-6">
          <div className="grid min-w-0 flex-1 gap-1">
            <h1 className="break-all text-[15px] font-semibold leading-snug">{file.name}</h1>
            <p className="text-muted tabular-nums">{info ? describeFile(info) : file.status === 'probing' ? 'Reading the file…' : ''}</p>
          </div>
          {info && editable && (
            <Dropdown
              id="preset"
              label="Preset"
              inline
              value={file.presetName ?? 'custom'}
              options={[
                ...(file.presetName ? [] : [{ value: 'custom', label: 'Your own settings', disabled: true }]),
                ...presets.map((p) => ({ value: p.name, label: p.name })),
              ]}
              onChange={applyPreset}
            />
          )}
        </header>
        {notice && <p className="text-muted">{notice}</p>}
        {presetWarning && <p className="text-warn">{presetWarning}</p>}

        {info && <ResultCard file={file} machine={machine} editable={editable} onChange={change} onEditAgain={editAgain} />}

        {info && editable && (
          <>
            <div className="flex items-center gap-4">
              {/* Tabs are navigation, not a choice: an underline, so orange fills stay for choices and Convert. */}
              <div role="tablist" aria-label="Settings" className="flex gap-5">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls="settings-panel"
                    onClick={() => setTab(t.id)}
                    className={classes(
                      'relative h-7 font-semibold after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      tab === t.id ? 'text-ink after:bg-accent' : 'text-muted hover:text-ink',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              {file.plan?.videoArgs && (
                <Button onClick={showPreview}>Preview 10 s</Button>
              )}
            </div>
            <section id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="rounded bg-surface p-5">
              {tab === 'tracks' && <TracksPanel info={info} settings={file.settings} machine={machine} onChange={change} />}
              {tab === 'picture' && <PicturePanel key={file.path} info={info} settings={file.settings} suggestedKbps={file.estimate?.videoKbps ?? null} onChange={change} />}
              {tab === 'advanced' && <AdvancedPanel info={info} settings={file.settings} onChange={change} onSavePreset={savePreset} />}
            </section>
          </>
        )}

        {file.plan && (
          <section aria-labelledby="what-happens" className="grid gap-2.5 rounded bg-surface p-5">
            <h2 id="what-happens" className="font-semibold">
              What will happen
            </h2>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {file.plan.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {file.plan.warnings.map((line) => (
                <li key={line} className="text-warn">
                  {line}
                </li>
              ))}
            </ul>
            {info && editable && (
              <div className="pt-1.5">
                <Checkbox
                  label="Move the original to the Trash when done"
                  checked={file.settings.trashOriginal}
                  onChange={(on) => change({ ...file.settings, trashOriginal: on })}
                />
              </div>
            )}
          </section>
        )}

        {file.error && (
          <p role="alert" className="text-bad">
            {file.error}
          </p>
        )}
        {file.log && file.log.length > 0 && (
          <details className="grid gap-2">
            <summary className="cursor-pointer font-semibold text-muted">Show details</summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-well p-3 font-mono text-xs">{file.log.join('\n')}</pre>
          </details>
        )}
        {file.extras && file.extras.length > 0 && <p className="text-good">{`Also saved: ${file.extras.map((p) => p.split(/[\\/]/).pop()).join(', ')}`}</p>}
        {file.notes?.map((note) => (
          <p key={note} className="text-warn">
            {note}
          </p>
        ))}
      </div>
      <PreviewDialog />
    </main>
  );
}
