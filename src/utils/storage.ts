import { SETTINGS_KEYS } from '@/app/settings/constants';
import { LANGUAGE_CHANGE_EVENT, SIDEBAR_COLLAPSE_EVENT } from '@/constants/storage';
import { readLanguageCache, writeLanguageCache } from '@/lib/language-cache';
import { DEFAULT_LANGUAGE, isValidLanguageCode, LANGUAGES } from '@/lib/languages';
import { LanguageConfig } from '@/types/language';
import { Theme } from '@/types/theme';

export function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, callback);
  };
}

export function setLanguageInStorage(code: string) {
  writeLanguageCache(code);
  window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

/**
 * Tell every mounted picker that the opted-in language list changed (#442).
 * Shares the language-change channel, which is what those pickers subscribe to.
 */
export function notifyLanguageListChanged() {
  window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
}

export function getLanguageSnapshot(): LanguageConfig {
  const stored = readLanguageCache() as keyof typeof LANGUAGES | null;
  if (stored && isValidLanguageCode(stored)) return LANGUAGES[stored];
  return LANGUAGES[DEFAULT_LANGUAGE];
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem(SETTINGS_KEYS.THEME) as Theme) || 'system';
}

export function subscribeToSidebarCollapsed(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(SIDEBAR_COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, callback);
  };
}

export function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SETTINGS_KEYS.SIDEBAR_COLLAPSED) === '1';
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_KEYS.SIDEBAR_COLLAPSED, collapsed ? '1' : '0');
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));
}
