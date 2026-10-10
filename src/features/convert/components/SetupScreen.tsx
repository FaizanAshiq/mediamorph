export function SetupScreen({ onCheckAgain }: { onCheckAgain(): void }) {
  return (
    <main className="grid h-full place-items-center p-8">
      <div className="grid max-w-md gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Mediamorph could not start ffmpeg</h1>
        <p className="text-muted">
          ffmpeg does the converting and comes inside Mediamorph. Download Mediamorph again and put it in place of this
          copy, then check again.
        </p>
        <button
          type="button"
          onClick={onCheckAgain}
          className="h-7 justify-self-start rounded-full bg-accent px-4 font-semibold text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Check again
        </button>
      </div>
    </main>
  );
}
