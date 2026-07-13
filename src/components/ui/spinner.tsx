import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const spinnerSizes = {
  sm: 'size-3 border-2',
  md: 'size-4 border-2',
  lg: 'size-8 border-4',
  xl: 'size-10 border-4',
} as const;

type SpinnerProps = Omit<ComponentProps<'span'>, 'children'> & {
  label?: string;
  size?: keyof typeof spinnerSizes;
};

function Spinner({ className, label, size = 'md', ...props }: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-current/25 border-t-current',
        spinnerSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export { Spinner, type SpinnerProps };
