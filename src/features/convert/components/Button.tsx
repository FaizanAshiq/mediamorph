import type { ButtonHTMLAttributes } from 'react';
import { classes } from '@/lib/classes';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The one action the screen is for: orange. */
  primary?: boolean;
}

export function Button({ primary, className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={classes(
        'h-7 shrink-0 rounded-full px-3.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40',
        primary ? 'bg-accent px-4 text-on-accent' : 'bg-raised text-ink shadow-sm',
        className,
      )}
    />
  );
}
