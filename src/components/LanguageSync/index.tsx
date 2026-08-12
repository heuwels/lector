'use client';

import { useEffect } from 'react';
import { readLanguageCache } from '@/lib/language-cache';

/**
 * Keep other tabs on the language the user selected.
 *
 * A language switch reloads the tab that made it (LanguageSelector), so that
 * tab refetches everything under the new language. Another open tab got no
 * such treatment. The `storage` event reaches it and the chrome re-reads its
 * snapshot, so the language name in the selector changes — but each page
 * loads its data once, on mount, and subscribes to nothing. The library kept
 * the collections of the previous language.
 *
 * That left the tab split: new language in the chrome, old language in the
 * list. Every card then pointed at a collection outside the active language,
 * and the API answers a by-id read outside the active language with a 404.
 * The collection page reads that as a deleted collection and returns the
 * reader to the library. Only a second language switch cleared it, because a
 * switch reloads the tab.
 *
 * Reload on the change instead. This matches what the acting tab already
 * does, and it covers every page at once, not the library alone. The
 * `storage` event fires only in OTHER tabs, so the acting tab cannot reload
 * twice.
 */
export default function LanguageSync() {
  useEffect(() => {
    // The language this tab loaded its data under. A cloud tab that has no
    // session yet reads null, and adopts the first value it sees.
    let current = readLanguageCache();

    function onStorage(event: StorageEvent) {
      // A null key means the whole store was cleared, so re-read for that too.
      if (event.key !== null && !event.key.startsWith('lector-target-language')) return;
      const next = readLanguageCache();
      if (next === null || next === current) return;
      current = next;
      window.location.reload();
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
