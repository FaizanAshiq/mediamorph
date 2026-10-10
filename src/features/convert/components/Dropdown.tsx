export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  id: string;
  label: string;
  value: string;
  options: DropdownOption[];
  disabled?: boolean;
  /** Label beside the field instead of above it. */
  inline?: boolean;
  onChange(value: string): void;
}

export function Dropdown({ id, label, value, options, disabled, inline, onChange }: DropdownProps) {
  return (
    <div className={inline ? 'flex items-center gap-2.5' : 'grid content-start gap-1.5'}>
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 rounded bg-well px-2.5 font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
