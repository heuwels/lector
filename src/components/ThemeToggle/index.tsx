'use client';

import { Theme } from '@/types/theme';
import { useTheme } from '@/utils/hooks';
import { MonitorIcon, MoonIcon, SunIcon } from '../icons';

const options: { value: Theme; icon: () => React.ReactElement; label: string }[] = [
    { value: 'light', icon: SunIcon, label: 'Light' },
    { value: 'dark', icon: MoonIcon, label: 'Dark' },
    { value: 'system', icon: MonitorIcon, label: 'System' },
];

export default function ThemeToggle() {
    const { theme, setTheme, mounted } = useTheme();

    if (!mounted) return null;

    return (
        <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {options.map((opt) => {
                const Icon = opt.icon;
                const isActive = theme === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTheme(opt.value)}
                        title={opt.label}
                        className={`rounded-md p-1.5 transition-colors ${isActive
                            ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                    >
                        <Icon />
                    </button>
                );
            })}
        </div>
    );
}
