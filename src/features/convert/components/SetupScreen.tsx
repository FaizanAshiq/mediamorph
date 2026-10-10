export function SetupScreen({ onCheckAgain }: { onCheckAgain(): void }) {
  return (
    <main className="grid h-full place-items-center p-8">
      <div className="grid max-w-md gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Mediamorph needs ffmpeg</h1>
        <p className="text-muted">ffmpeg does the actual converting. Install it with Homebrew in Terminal, then check again.</p>
        <code className="select-all rounded bg-well px-3 py-2 font-mono">brew install ffmpeg</code>
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
