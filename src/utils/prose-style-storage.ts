// Browser storage for the reader typography settings (#570).
//
// localStorage, not a server setting, and browser-scoped rather than
// tenant-scoped — the same choice the theme makes, for the same reason. The
// right font size is a property of the screen in front of the reader, not of
// the account: a phone and a 27-inch monitor want different numbers, and one
// synced value would fight whichever device it was not set on. A typography
// preference that carries over to another account in the same browser is the
// desired behaviour here, not a leak.

import { PROSE_STYLE_CHANGE_EVENT } from '@/constants/storage';
import { SETTINGS_KEYS } from '@/app/settings/constants';
import {
  EMPTY_PROSE_STYLE_SETTINGS,
  parseProseStyleSettings,
  type ProseStyleSettings,
} from '@/lib/prose-style';

// `useSyncExternalStore` compares snapshots by identity and re-renders whenever
// one changes, so parsing on every read would loop forever. Cache the parse
// against the raw string it came from: a read after no write returns the same
// object, and a write produces a new one exactly once.
let cachedRaw: string | null = null;
let cachedSettings: ProseStyleSettings = EMPTY_PROSE_STYLE_SETTINGS;

export function subscribeToProseStyle(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(PROSE_STYLE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(PROSE_STYLE_CHANGE_EVENT, callback);
  };
}

export function readProseStyleSettings(): ProseStyleSettings {
  if (typeof window === 'undefined') return EMPTY_PROSE_STYLE_SETTINGS;
  const raw = window.localStorage.getItem(SETTINGS_KEYS.PROSE_STYLE);
  if (raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  if (!raw) {
    cachedSettings = EMPTY_PROSE_STYLE_SETTINGS;
    return cachedSettings;
  }
  try {
    cachedSettings = parseProseStyleSettings(JSON.parse(raw));
  } catch {
    // A malformed value must not blank the reader. Fall back to the defaults
    // and leave the value in place, so a later app version can still read it.
    cachedSettings = EMPTY_PROSE_STYLE_SETTINGS;
  }
  return cachedSettings;
}

/** SSR and the hydration pass both need a stable object with no storage read. */
export function serverProseStyleSettings(): ProseStyleSettings {
  return EMPTY_PROSE_STYLE_SETTINGS;
}

export function writeProseStyleSettings(settings: ProseStyleSettings): void {
  if (typeof window === 'undefined') return;
  const isEmpty =
    Object.keys(settings.global).length === 0 && Object.keys(settings.byLanguage).length === 0;
  if (isEmpty) window.localStorage.removeItem(SETTINGS_KEYS.PROSE_STYLE);
  else window.localStorage.setItem(SETTINGS_KEYS.PROSE_STYLE, JSON.stringify(settings));
  // The storage event only fires in the OTHER tabs, so tell this one directly.
  window.dispatchEvent(new Event(PROSE_STYLE_CHANGE_EVENT));
}
