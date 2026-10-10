import type { ReactNode } from 'react';
import { speedChoices } from '../engine/choices';
import { qualityWords } from '../engine/codecs';
import type { Estimate } from '../engine/estimate';
import { FORMAT_ORDER, FORMATS } from '../engine/formats';
import { sourceVideoKbps } from '../engine/planner';
import { displaySize, sizeChoices } from '../engine/sizes';
import type { FileInfo, Format, Machine, Settings, Size } from '../engine/types';
import { formatBytes, formatDuration } from '../engine/words';
import { sizeText } from '../status';
import type { FileStatus, OpenFile } from '../store';
import { classes } from '@/lib/classes';
import { Dropdown } from './Dropdown';
import { QualitySlider } from './QualitySlider';
import { SpeedPicker } from './SpeedPicker';
import { useFileUrl } from './useFileUrl';

const FORMAT_OPTIONS = FORMAT_ORDER.map((f) => ({ value: f, label: FORMATS[f].label }));
const PHASE: Partial<Record<FileStatus, string>> = {
  measuring: 'Measuring loudness',
  'first-pass': 'First pass',
  running: 'Converting',
  verifying: 'Checking the result',
};

interface ResultCardProps {
  file: OpenFile;
  machine: Machine;
  editable: boolean;
  onChange(settings: Settings): void;
  onEditAgain(): void;
}

/** The hero: a picture from the file, and the size it has now against the size it will have. */
export function ResultCard({ file, machine, editable, onChange, onEditAgain }: ResultCardProps) {
  const frameUrl = useFileUrl(file.frame);
  const info = file.info!;
  const settings = file.settings;
  const format = FORMATS[settings.format];
  const video = info.video;
  const update = (edit: (s: Settings) => void) => {
    const next = structuredClone(settings);
    edit(next);
    onChange(next);
  };
  const sizes = sizeChoices(video && displaySize(video)).map((c) => ({ value: String(c.value), label: c.label, disabled: c.disabled }));

  return (
    <section aria-label="Result" className="grid grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-7 rounded bg-surface p-5">
      <div className="grid content-start gap-3.5">
        {frameUrl ? (
          <img src={frameUrl} alt={`A frame from ${file.name}`} className="aspect-[420/173] w-full rounded object-cover" />
        ) : (
          <div aria-hidden="true" className="aspect-[420/173] w-full rounded bg-well" />
        )}
        {editable && (
          <div className="grid grid-cols-2 gap-2.5">
            <Dropdown
              id="format"
              label="Format"
              value={settings.format}
              options={FORMAT_OPTIONS}
              onChange={(value) => update((s) => void (s.format = value as Format))}
            />
            <Dropdown
              id="size"
              label="Size"
              value={String(settings.size)}
              options={format.audioOnly ? [{ value: String(settings.size), label: 'Not used for audio only' }] : sizes}
              disabled={format.audioOnly || !video}
              onChange={(value) => update((s) => void (s.size = value === 'original' ? 'original' : (Number(value) as Size)))}
            />
          </div>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-5">
        {editable && <Planned file={file} machine={machine} onChange={onChange} />}
        {PHASE[file.status] && <Converting file={file} />}
        {file.status === 'done' && <Finished file={file} onEditAgain={onEditAgain} />}
      </div>
    </section>
  );
}

function Planned({ file, machine, onChange }: { file: OpenFile; machine: Machine; onChange(settings: Settings): void }) {
  const info = file.info!;
  const settings = file.settings;
  const rate = settings.video.rate;
  const audioOnly = FORMATS[settings.format].audioOnly;
  const estimate = file.estimate;
  const copied = file.plan?.tracks.some((t) => t.kind === 'video' && t.action === 'copy') ?? false;
  const words = copied ? 'No quality loss' : capitalised(qualityWords(rate.mode === 'quality' ? rate.quality : 100));
  const note = audioOnly ? 'Not used for audio only' : rate.mode !== 'quality' ? 'Set in Picture' : undefined;
  const after = sizeText(estimate);

  return (
    <>
      <Hero value={after ? capitalised(after) : 'Working it out…'}>
        {estimate && <span>{share(estimate.bytes, info.sizeBytes)} of the original</span>}
        {estimate && <Change before={info.sizeBytes} after={estimate.bytes} />}
        {estimate?.seconds != null && <span>{timeText(estimate.seconds)}</span>}
        {file.checking && <span>checking…</span>}
      </Hero>
      {estimate && (
        <SizeRows before={info.sizeBytes} after={estimate.bytes} beforeKbps={videoKbpsOf(info)} afterKbps={estimate.videoKbps} afterWord={KBPS_WORD[estimate.kind]} />
      )}
      <QualitySlider
        value={rate.mode === 'quality' ? rate.quality : 100}
        words={words}
        size={null}
        note={note}
        disabled={audioOnly || !info.video || rate.mode !== 'quality'}
        onChange={(quality) => onChange({ ...settings, video: { ...settings.video, rate: { mode: 'quality', quality } } })}
      />
      <SpeedPicker
        value={settings.video.speed}
        choices={speedChoices(settings, info, machine)}
        disabled={audioOnly || !info.video || copied}
        onChange={(speed) => onChange({ ...settings, video: { ...settings.video, speed } })}
      />
    </>
  );
}

function Converting({ file }: { file: OpenFile }) {
  const fraction = file.progress?.fraction ?? null;
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const eta = file.progress?.etaSec ?? null;
  return (
    <>
      <Hero value={percent === null ? '…' : `${percent}%`}>
        <span>{PHASE[file.status]}</span>
        {eta !== null && <span>{eta < 60 ? 'under a minute left' : `${formatDuration(eta)} left`}</span>}
      </Hero>
      <div
        role="progressbar"
        aria-label={PHASE[file.status]}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-track"
      >
        <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <p className="text-muted">
        {file.estimate ? `Heading for about ${formatBytes(file.estimate.bytes)}. ` : ''}Your Mac stays awake until it is done. Settings are
        locked while it converts; Stop to change them.
      </p>
    </>
  );
}

function Finished({ file, onEditAgain }: { file: OpenFile; onEditAgain(): void }) {
  const info = file.info!;
  const output = file.output!;
  return (
    <>
      <Hero value={formatBytes(output.sizeBytes)}>
        <span className="font-semibold text-good">Done</span>
        <span>{share(output.sizeBytes, info.sizeBytes)} of the original</span>
        <Change before={info.sizeBytes} after={output.sizeBytes} />
      </Hero>
      <SizeRows before={info.sizeBytes} after={output.sizeBytes} beforeKbps={videoKbpsOf(info)} afterKbps={videoKbpsOf(output)} afterWord="" labels={['Before', 'After']} />
      <div className="grid gap-1">
        <p className="break-all font-semibold">{output.path.split(/[\\/]/).pop()}</p>
        <p className="text-muted">Checked: length, tracks and picture size match.</p>
      </div>
      <button
        type="button"
        onClick={onEditAgain}
        className="h-7 justify-self-start rounded-full bg-well px-3.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Convert again with other settings
      </button>
    </>
  );
}

/** The one big figure of each state, with a caption of plain facts under it. It wraps rather than cuts. */
function Hero({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-[30px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted tabular-nums">{children}</p>
    </div>
  );
}

function share(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

const KBPS_WORD: Record<Estimate['kind'], string> = { exact: '', measured: 'about ', guess: 'roughly ' };

function videoKbpsOf(info: FileInfo): number | null {
  return info.video ? sourceVideoKbps(info, info.video) : null;
}

interface SizeRowsProps {
  before: number;
  after: number;
  beforeKbps: number | null;
  afterKbps: number | null;
  /** "about" or "roughly" before the after figures, while they are not exact. */
  afterWord: string;
  /** Now and After while planning; Before and After once the file is done. */
  labels?: [string, string];
}

/**
 * Now and After on one scale: each bar is that file's size against the bigger of the two, with its size and video
 * bitrate, the number to type into Fixed bitrate next time.
 */
function SizeRows({ before, after, beforeKbps, afterKbps, afterWord, labels = ['Now', 'After'] }: SizeRowsProps) {
  const scale = Math.max(before, after);
  const rows = [
    { label: labels[0], bytes: before, kbps: beforeKbps, word: '', fill: 'bg-faint' },
    { label: labels[1], bytes: after, kbps: afterKbps, word: afterWord, fill: 'bg-accent' },
  ];
  return (
    <ul aria-label="Size and bitrate" className="m-0 grid list-none gap-2 p-0">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-muted">{row.label}</span>
          <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-track">
            <span className={classes('block h-full rounded-full', row.fill)} style={{ width: `${(row.bytes / scale) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">
            {`${row.word}${[formatBytes(row.bytes), row.kbps ? `${Math.round(row.kbps)} kbps video` : null].filter(Boolean).join(' · ')}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Within 2 percent reads as the same size: a lossless copy gains about 1 percent of container overhead. */
function Change({ before, after }: { before: number; after: number }) {
  if (Math.abs(before - after) < before * 0.02) return <span>About the same size</span>;
  return after < before ? (
    <span className="font-semibold text-good">{formatBytes(before - after)} smaller</span>
  ) : (
    <span className="font-semibold text-warn">{formatBytes(after - before)} bigger</span>
  );
}

function timeText(seconds: number): string {
  return seconds < 60 ? 'under a minute' : `about ${formatDuration(seconds)}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
