import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const spinnerSizes = {
  sm: 'size-3',
  md: 'size-4',
  lg: 'size-8',
  xl: 'size-10',
} as const;

type SpinnerProps = Omit<ComponentProps<'svg'>, 'children'> & {
  label?: string;
  size?: keyof typeof spinnerSizes;
  /**
   * 'brand' (default): sage arc over a border-colored track, with the slow
   * sage → clay → gold drift. 'current': follows currentColor and drops the
   * drift — for use inside colored controls (e.g. a primary button).
   */
  tone?: 'brand' | 'current';
};

/** Brand loading ring (design sheet: lector-design-demos/10-spinners.html #2). */
function Spinner({ className, label, size = 'md', tone = 'brand', ...props }: SpinnerProps) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 44 44"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'spin-ring inline-block shrink-0',
        tone === 'current' && 'spin-ring--current',
        spinnerSizes[size],
        className,
      )}
      {...props}
    >
      <circle className="spin-ring-track" cx="22" cy="22" r="18" strokeWidth="5" />
      <circle className="spin-ring-arc" cx="22" cy="22" r="18" strokeWidth="5" />
    </svg>
  );
}

export { Spinner, type SpinnerProps };
