import { DEFAULT_LANGUAGE } from '@/constants/languages';
import { LANGUAGES } from '@/lib/languages';
import { LanguageConfig } from '@/types/language';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getLanguageSnapshot, getStoredTheme, subscribeToStorage } from './storage';
import { applyTheme, getEffectiveTheme } from './theme';
import { Theme } from '@/types/theme';

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
  return useSyncExternalStore(subscribeToStorage, getLanguageSnapshot, () => LANGUAGES[DEFAULT_LANGUAGE]);
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
    localStorage.setItem('theme', t);
    applyTheme(t);
  };

  const effectiveTheme = mounted ? getEffectiveTheme(theme) : 'dark';

  return { theme, effectiveTheme, setTheme, mounted };
}