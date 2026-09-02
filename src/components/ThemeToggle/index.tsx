'use client';

import clsx from 'clsx';
import { useTheme } from '@/utils/hooks';
import { OPTIONS } from './constants';
import ThemeButton from './components/ThemeButton';

export default function ThemeToggle({ vertical = false }: { vertical?: boolean }) {
  const { mounted } = useTheme();

  if (!mounted) return null;

  return (
    <div
      className={clsx(
        'flex gap-1 rounded-lg bg-muted p-1',
        vertical ? 'flex-col items-center' : 'items-center',
      )}
    >
      {OPTIONS.map(ThemeButton)}
    </div>
  );
}
