interface QualitySliderProps {
  value: number;
  /** What the position means, such as "Slight softening"; replaced by `note` when the slider is not in use. */
  words: string;
  size: string | null;
  note?: string;
  disabled: boolean;
  onChange(value: number): void;
}

/** Quality against size, HandBrake style: left is a smaller file, right is the original's quality. */
export function QualitySlider({ value, words, size, note, disabled, onChange }: QualitySliderProps) {
  const shown = note ?? [words, size].filter(Boolean).join(' · ');
  return (
    <div className="grid content-start gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="quality" className="font-semibold">
          Quality
        </label>
        <span className="text-right tabular-nums text-muted">{shown}</span>
      </div>
      <input
        id="quality"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        aria-valuetext={note ?? words}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-check disabled:opacity-50"
      />
      <div aria-hidden="true" className="flex justify-between text-xs text-muted">
        <span>Smaller file</span>
        <span>Best quality</span>
      </div>
    </div>
  );
}
