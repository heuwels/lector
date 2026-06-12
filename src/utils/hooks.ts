import { DEFAULT_LANGUAGE } from '@/constants/languages';
import { LANGUAGES } from '@/lib/languages';
import { LanguageConfig } from '@/types/language';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getLanguageSnapshot, subscribeToStorage } from './storage';

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