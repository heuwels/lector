import { DEFAULT_LANGUAGE } from '@/constants/languages';
import { normalizeEnabledLanguages, LANGUAGES } from '@/lib/languages';
import { LanguageCode, LanguageConfig } from '@/types/language';
import { getSetting } from '@/lib/data-layer';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getLanguageSnapshot, getStoredTheme, subscribeToStorage } from './storage';
import { applyTheme, getEffectiveTheme } from './theme';
import { Theme } from '@/types/theme';
import { SETTINGS_KEYS } from '@/app/settings/constants';

export function useIsDark() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function useActiveLanguage(): LanguageConfig {
  return useSyncExternalStore(
    subscribeToStorage,
    getLanguageSnapshot,
    () => LANGUAGES[DEFAULT_LANGUAGE],
  );
}

/**
 * The languages this account opted into (#442). Empty until the setting loads,
 * and empty for an account that has none — callers add the active language.
 */
export function useEnabledLanguages(): LanguageCode[] {
  const [codes, setCodes] = useState<LanguageCode[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      getSetting<string[]>('enabledLanguages')
        .then((stored) => {
          if (!cancelled) setCodes(normalizeEnabledLanguages(stored ?? []));
        })
        .catch((error) => {
          // A failed read is not an empty list. The picker falls back to the
          // active language alone, which must not look like a deliberate list.
          console.error('Could not load the opted-in languages:', error);
        });
    };

    load();
    const unsubscribe = subscribeToStorage(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return codes;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);

    // Listen for system theme changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(SETTINGS_KEYS.THEME, t);
    applyTheme(t);
  };

  const effectiveTheme = mounted ? getEffectiveTheme(theme) : 'dark';

  return { theme, effectiveTheme, setTheme, mounted };
}
