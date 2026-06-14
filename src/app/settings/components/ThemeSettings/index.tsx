import { type Theme } from '@/types/theme';
import { useTheme } from '@/utils/hooks';

export default function ThemeSettings() {
  const { theme, setTheme } = useTheme();

  const handleThemeChanged = (theme: Theme) => {
    setTheme(theme);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Appearance</h2>
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Theme
        </label>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as Theme[]).map((themeOpt) => (
            <button
              key={themeOpt}
              data-theme={themeOpt}
              onClick={() => handleThemeChanged(themeOpt)}
              className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                theme === themeOpt
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {themeOpt}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
