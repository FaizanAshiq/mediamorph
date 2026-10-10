import type { ReactNode } from 'react';

interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** Shown at the end of the row, such as "Plays first". */
  after?: ReactNode;
  onChange(checked: boolean): void;
}

export function Checkbox({ label, checked, disabled, after, onChange }: CheckboxProps) {
  return (
    <div className="flex items-center gap-2.5">
      <label className={`flex flex-1 items-center gap-2.5 ${disabled ? 'text-muted' : ''}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-check" />
        <span>{label}</span>
      </label>
      {after}
    </div>
  );
}
