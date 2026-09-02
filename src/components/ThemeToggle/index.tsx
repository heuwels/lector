'use client';

import clsx from 'clsx';
import { Theme } from '@/types/theme';
import { useTheme } from '@/utils/hooks';
import { OPTIONS } from './constants';
import ThemeButton from './components/ThemeButton';

export default function ThemeToggle({ vertical = false }: { vertical?: boolean }) {
  const { mounted, setTheme, theme } = useTheme();

  if (!mounted) {
    return null;
  }

  const handleThemeButtonPressed = (theme: Theme) => {
    setTheme(theme);
  };

  return (
    <div
      className={clsx(
        'flex gap-1 rounded-lg bg-muted p-1',
        vertical ? 'flex-col items-center' : 'items-center',
      )}
    >
      {OPTIONS.map((opt) => (
        <ThemeButton key={opt.value} {...opt} onClick={handleThemeButtonPressed} theme={theme} />
      ))}
    </div>
  );
}
