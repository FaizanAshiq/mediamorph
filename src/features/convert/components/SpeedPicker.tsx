import { classes } from '@/lib/classes';
import type { SpeedChoice } from '../engine/choices';
import type { Speed } from '../engine/types';

interface SpeedPickerProps {
  value: Speed;
  choices: SpeedChoice[];
  disabled: boolean;
  onChange(speed: Speed): void;
}

/** Fast, Balanced or Smallest file: the same look, bought with time. A segmented toggle over real radio inputs. */
export function SpeedPicker({ value, choices, disabled, onChange }: SpeedPickerProps) {
  const picked = choices.find((c) => c.value === value);
  return (
    <fieldset className="m-0 grid gap-1.5 border-0 p-0">
      <div className="flex items-center justify-between gap-3">
        <legend className="float-left p-0 font-semibold">Speed</legend>
        <div className="flex gap-0.5 rounded-full bg-track p-0.5">
          {choices.map((choice) => {
            // Styled from state, not :checked or :disabled: WebKit does not restyle those siblings when React changes the input.
            const checked = choice.value === value;
            const off = disabled || choice.disabled;
            return (
              <label key={choice.value} title={choice.note}>
                <input
                  type="radio"
                  name="speed"
                  value={choice.value}
                  checked={checked}
                  disabled={off}
                  aria-describedby={checked ? 'speed-note' : undefined}
                  onChange={() => onChange(choice.value as Speed)}
                  className="peer sr-only"
                />
                <span
                  className={classes(
                    'grid h-6 place-items-center rounded-full px-3 font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    checked ? 'bg-accent text-on-accent' : 'text-muted',
                    off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                    !checked && !off && 'hover:text-ink',
                  )}
                >
                  {choice.label}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      {picked && (
        <p id="speed-note" className="m-0 text-muted">
          {picked.note}
        </p>
      )}
    </fieldset>
  );
}
