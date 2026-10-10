import { useEffect, useState } from 'react';
import { updateNote } from '../platform/tauri';

/** "Updated to Mediamorph X" for a few seconds after an update, in the strip that drags the window. */
export function UpdateNote({ read = updateNote, seconds = 6 }: { read?: () => Promise<string | null>; seconds?: number }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void read().then((found) => mounted && setVersion(found));
    return () => {
      mounted = false;
    };
  }, [read]);

  useEffect(() => {
    if (!version) return;
    const timer = setTimeout(() => setVersion(null), seconds * 1000);
    return () => clearTimeout(timer);
  }, [version, seconds]);

  return (
    <span data-tauri-drag-region className="flex flex-1 items-center self-stretch text-[13px] text-muted">
      {version && `Updated to Mediamorph ${version}`}
    </span>
  );
}
