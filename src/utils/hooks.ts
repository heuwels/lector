import { DEFAULT_LANGUAGE } from '@/constants/languages';
import { normalizeEnabledLanguages, LANGUAGES } from '@/lib/languages';
import { LanguageCode, LanguageConfig } from '@/types/language';
import { getSetting } from '@/lib/data-layer';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useThrottledCallback } from 'use-debounce';
import { useWindowSize } from 'usehooks-ts';
import { getLanguageSnapshot, getStoredTheme, subscribeToStorage } from './storage';
import {
  readProseStyleSettings,
  serverProseStyleSettings,
  subscribeToProseStyle,
} from './prose-style-storage';
import type { ProseStyleSettings } from '@/lib/prose-style';
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

/**
 * The reader typography settings (#570). Read straight out of browser storage,
 * so a reader that changes the setting in another tab sees it here too.
 *
 * `useSyncExternalStore` rather than an effect, because the reader must draw
 * the right size on its FIRST paint. An effect would paint the default and then
 * jump to the stored size, which reads as a fault at the top of a lesson.
 */
export function useProseStyleSettings(): ProseStyleSettings {
  return useSyncExternalStore(
    subscribeToProseStyle,
    readProseStyleSettings,
    serverProseStyleSettings,
  );
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

export function useScreenSize(): 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' {
  const { width } = useWindowSize();

  if (width < 640) {
    return 'xs';
  }

  if (width < 768) {
    return 'sm';
  }

  if (width < 1024) {
    return 'md';
  }

  if (width < 1280) {
    return 'lg';
  }

  if (width < 1536) {
    return 'xl';
  }

  return '2xl';
}
