import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

export type Appearance = 'system' | 'light' | 'dark';

const KEY = 'mediamorph.appearance';

function saved(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Light, Dark or the system's choice; remembered on this Mac, applied to the page and the window frame. */
export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const [appearance, setAppearance] = useState<Appearance>(saved);

  useEffect(() => {
    const root = document.documentElement;
    if (appearance === 'system') delete root.dataset.theme;
    else root.dataset.theme = appearance;
    try {
      localStorage.setItem(KEY, appearance);
    } catch {
      // A blocked store only means the choice is not remembered.
    }
    // The title bar, menus and native pickers follow the window's own theme. Outside the app (tests) there is no window.
    try {
      void getCurrentWindow()
        .setTheme(appearance === 'system' ? null : appearance)
        .catch(() => undefined);
    } catch {
      // No Tauri window to theme.
    }
  }, [appearance]);

  return [appearance, setAppearance];
}
