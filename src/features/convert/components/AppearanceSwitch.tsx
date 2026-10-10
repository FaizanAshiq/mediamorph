import type { ReactElement } from 'react';
import { classes } from '@/lib/classes';
import { useAppearance, type Appearance } from '@/lib/appearance';

const CHOICES: { value: Appearance; label: string; icon: ReactElement }[] = [
  {
    value: 'system',
    label: 'Match the system',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="7" cy="7" r="5.25" />
        <path d="M7 1.75v10.5A5.25 5.25 0 0 0 7 1.75z" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="2.75" />
        <path d="M7 1v1.25M7 11.75V13M1 7h1.25M11.75 7H13M2.75 2.75l.9.9M10.35 10.35l.9.9M2.75 11.25l.9-.9M10.35 3.65l.9-.9" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M11.75 8.6A5 5 0 0 1 5.4 2.25a5 5 0 1 0 6.35 6.35z" />
      </svg>
    ),
  },
];

/** Match the system, Light or Dark: a small segmented toggle over real radio inputs. */
export function AppearanceSwitch() {
  const [appearance, setAppearance] = useAppearance();
  return (
    <fieldset className="m-0 flex gap-0.5 rounded-full border-0 bg-well p-0.5">
      <legend className="sr-only">Appearance</legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} title={choice.label}>
          <input
            type="radio"
            name="appearance"
            value={choice.value}
            aria-label={choice.label}
            checked={appearance === choice.value}
            onChange={() => setAppearance(choice.value)}
            className="peer sr-only"
          />
          <span
            className={classes(
              'grid h-6 w-[30px] cursor-pointer place-items-center rounded-full peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent',
              appearance === choice.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink',
            )}
          >
            {choice.icon}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
