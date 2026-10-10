import { showInFolder } from '../platform/tauri';
import { useConvert } from '../store';
import { AppearanceSwitch } from './AppearanceSwitch';
import { Button } from './Button';

const BUSY = new Set(['measuring', 'first-pass', 'running', 'verifying']);

/** The window's top strip: it drags the window, leaves room for the traffic lights and holds the one action that matters now. */
export function TitleBar({ onOpen }: { onOpen(): void }) {
  const file = useConvert((s) => s.file);
  const convert = useConvert((s) => s.convert);
  const stop = useConvert((s) => s.stop);
  const open = useConvert((s) => s.open);
  const status = file?.status;

  return (
    <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-2.5 bg-chrome pl-[88px] pr-4">
      <span data-tauri-drag-region className="flex-1 self-stretch" />
      <AppearanceSwitch />
      {file && status && !BUSY.has(status) && <Button onClick={onOpen}>Open another</Button>}
      {status === 'ready' && (
        <Button primary onClick={() => void convert()}>
          Convert
        </Button>
      )}
      {status && BUSY.has(status) && <Button onClick={() => void stop()}>Stop</Button>}
      {status === 'done' && file?.output && (
        <Button primary onClick={() => void showInFolder(file.output!.path)}>
          Show in Finder
        </Button>
      )}
      {(status === 'failed' || status === 'cancelled') && (
        <Button primary onClick={() => void (file?.info ? convert() : open([file!.path]))}>
          Try again
        </Button>
      )}
    </header>
  );
}
