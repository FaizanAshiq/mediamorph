import { useEffect, useState } from 'react';
import { useConvert } from '../store';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4' };

/** A page-safe address for a picture or clip the engine saved in the cache folder. */
export function useFileUrl(path: string | undefined): string | null {
  const readImage = useConvert((s) => s.readImage);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let live = true;
    let made: string | null = null;
    const type = TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
    void readImage(path)
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, readImage]);

  return url;
}
