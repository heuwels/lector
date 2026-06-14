import { type Theme } from '@/types/theme';
import { useTheme } from '@/utils/hooks';

export default function ThemeSettings() {
  const { theme, setTheme } = useTheme();

  const handleThemeChanged = (theme: Theme) => {
    setTheme(theme);
  };

  return (
    <section className="panel p-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">Appearance</h2>
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
                  ? 'border-primary bg-[var(--primary-soft)] text-primary'
                  : 'border-border bg-card text-foreground hover:bg-accent'
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
