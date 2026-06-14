'use client';

import { Monitor, Sun, Moon, type LucideIcon } from 'lucide-react';
import { Theme } from '@/types/theme';
import { useTheme } from '@/utils/hooks';

const options: { value: Theme; icon: LucideIcon; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export default function ThemeToggle() {
  const { theme, setTheme, mounted } = useTheme();

  if (!mounted) return null;

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            title={opt.label}
            className={`rounded-md p-1.5 transition-colors ${
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size="14" />
          </button>
        );
      })}
    </div>
  );
}
