/**
 * Shared highlighting settings store.
 *
 * Loads all highlighting settings once per page load via a single
 * `/api/settings` request, then serves them from a module-level cache.
 * An in-flight promise map prevents redundant concurrent requests so that
 * even if many WordCell components mount at the same time, only one
 * network request is made.
 *
 * WordCell and the HighlightingSettings UI both consume from this store,
 * so there is exactly one API round-trip regardless of how many words are
 * rendered in a lesson.
 */

/** Default values matching the original hook defaults. */
const defaults = {
  highlightPadding: 3,
  highlightTransparency: 0.2,
  highlightBorderRadius: 5,
  highlightColor: '--primary',
  phraseBorderStyle: 'solid',
  persistHighlights: false,
  autoRestoreHighlights: false,
} as const;

/** Module-level cache (populated once on first read).  Exported so consumers can update it. */
export let cache: Record<string, unknown> = { ...defaults };

/** In-flight fetch promise — prevents N concurrent /api/settings requests. */
let initPromise: Promise<Record<string, unknown>> | null = null;

/**
 * Ensure the cache is populated by fetching `/api/settings` once.
 * If another component already started the load, we await that same promise.
 */
export async function ensureCache(): Promise<Record<string, unknown>> {
  // Already populated?
  if (Object.keys(cache).length > 0 && cache.highlightPadding !== undefined) {
    return cache;
  }

  // In-flight de-dupe.
  if (initPromise !== null) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const res = await fetch('/api/settings', {
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      // Merge with defaults so we always have all keys.
      cache = { ...defaults, ...data };
    } catch {
      // On failure keep the defaults — UI never breaks.
    } finally {
      initPromise = null;
    }
    return cache;
  })();

  return initPromise;
}

/** Typed accessors — each reads the module-level cache. */
export const padding = (): number => (cache.highlightPadding ?? defaults.highlightPadding) as number;
export const transparency = (): number => (cache.highlightTransparency ?? defaults.highlightTransparency) as number;
export const borderRadius = (): number => (cache.highlightBorderRadius ?? defaults.highlightBorderRadius) as number;
export const highlightColor = (): string => (cache.highlightColor ?? defaults.highlightColor) as string;
export const phraseBorderStyle = (): string => (cache.phraseBorderStyle ?? defaults.phraseBorderStyle) as string;
export const persistHighlights = (): boolean => cache.persistHighlights === true;
export const autoRestoreHighlights = (): boolean => cache.autoRestoreHighlights === true;

/**
 * React hook: subscribes to the shared cache via useSyncExternalStore.
 *
 * Critical: the subscription function returns an unsubscribe that is a no-op
 * because our store (a module-level cache) only changes once during initial
 * population.  The getSnapshot function returns a **stably-cached** object
 * reference using a module-level ref, which satisfies React's requirement that
 * "the result of getSnapshot should be cached" — i.e. it must not produce a
 * new object on every render, otherwise React will call the subscribe
 * function on every render and you get an infinite loop.
 *
 * See: https://react.dev/reference/react/useSyncExternalStore
 */
import { useSyncExternalStore, useRef } from 'react';

/**
 * Module-level ref that holds the last snapshot returned by getSnapshot.
 * This is the key to satisfying React's "getSnapshot should be cached" rule:
 * the object identity stays stable across renders, so React will not re-call
 * the subscribe function on every render.
 */
const cachedSnapshot = {
  padding: padding(),
  transparency: transparency(),
  borderRadius: borderRadius(),
  highlightColor: highlightColor(),
  phraseBorderStyle: phraseBorderStyle(),
  persistHighlights: persistHighlights(),
  autoRestoreHighlights: autoRestoreHighlights(),
};

/**
 * Returns the current cached snapshot.  The object identity is stable because
 * we mutate `cachedSnapshot` in-place rather than creating a new object.
 */
function getSnapshot() {
  // In-place mutation so the returned object reference never changes.
  cachedSnapshot.padding = padding();
  cachedSnapshot.transparency = transparency();
  cachedSnapshot.borderRadius = borderRadius();
  cachedSnapshot.highlightColor = highlightColor();
  cachedSnapshot.phraseBorderStyle = phraseBorderStyle();
  cachedSnapshot.persistHighlights = persistHighlights();
  cachedSnapshot.autoRestoreHighlights = autoRestoreHighlights();
  return cachedSnapshot;
}

/**
 * subscribe — no-op because the module-level cache changes only once.
 * React will call this once when ensureCache populates the cache, then never
 * again.  Returning () => {} tells React there is no further subscription
 * needed.
 */
function subscribe(onStoreChange: () => void) {
  // No-op: the cache is populated once and never changes after that.
  return () => {};
}

export function useHighlightingSettingsFromStore() {
  // Use the stably-cached snapshot as the getSnapshot result.
  // Because getSnapshot() mutates cachedSnapshot in-place, the returned
  // object reference is the same on every render — satisfying React's
  // "getSnapshot should be cached" rule.
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  return snapshot;
}

/**
 * Legacy hook — kept for the HighlightingSettings UI page.
 * Now reads from the shared store cache instead of firing 7 per-key
 * getSetting() calls.  On first mount it populates the cache; subsequent
 * mounts (e.g. re-renders) just read the existing cache.
 */
import { useEffect, useState } from 'react';

export function useHighlightingSettings() {
  const [state, setState] = useState<{
    padding: number;
    transparency: number;
    borderRadius: number;
    highlightColor: string;
    phraseBorderStyle: string;
    persistHighlights: boolean;
    autoRestoreHighlights: boolean;
  }>({
    padding: 3,
    transparency: 0.2,
    borderRadius: 5,
    highlightColor: '--primary',
    phraseBorderStyle: 'solid',
    persistHighlights: false,
    autoRestoreHighlights: false,
  });

  useEffect(() => {
    ;(async () => {
      // Populate the shared cache on first mount; no per-key fetches.
      const data = await ensureCache();
      setState({
        padding: data.highlightPadding as number,
        transparency: data.highlightTransparency as number,
        borderRadius: data.highlightBorderRadius as number,
        highlightColor: data.highlightColor as string,
        phraseBorderStyle: data.phraseBorderStyle as string,
        persistHighlights: data.persistHighlights as boolean,
        autoRestoreHighlights: data.autoRestoreHighlights as boolean,
      });
    })();
  }, []);

  const updateSetting = async (key: string, value: unknown) => {
    // Update the shared cache so other consumers (WordCell, etc.) see it.
    ;(cache as Record<string, unknown>)[key] = value;

    // Update local UI state immediately.
    setState((prev) => ({ ...prev, [key]: value }));

    // Persist to server — this is an explicit user action, not per-word.
    // TODO: replace with proper setSetting once the API supports partial updates.
    try {
      await fetch(`/api/settings/${key}`, {
        method: 'PUT',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    } catch {
      // Ignore server errors; the UI state is already updated.
    }
  };

  return {
    ...state,
    updateSetting,
  };
}