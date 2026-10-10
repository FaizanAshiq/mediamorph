import { classes } from '@/lib/classes';

export function EmptyState({ dragging, onChoose }: { dragging: boolean; onChoose(): void }) {
  return (
    <main className="flex min-h-0 flex-1 p-7">
      <div
        className={classes(
          'flex flex-1 flex-col items-center justify-center gap-3 rounded text-center transition-colors',
          dragging ? 'bg-well' : 'bg-surface',
        )}
      >
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-accent text-on-accent">
          <svg width="22" height="22" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4v14M7 12l6 6 6-6M5 22h16" />
          </svg>
        </span>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{dragging ? 'Drop to open it' : 'Drop a video here'}</h1>
        <p className="text-muted">MKV, MP4, MOV, AVI, WebM and most others. One file at a time.</p>
        <button
          type="button"
          onClick={onChoose}
          className="h-7 rounded-full bg-well px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Choose a file
        </button>
      </div>
    </main>
  );
}
