'use client';

/**
 * Hydration-safe reads of the runtime browser config (#218). window.__ENV__
 * is invisible to SSR, so components can't branch on it during the first
 * render. useSyncExternalStore gives the exact semantics needed with no
 * setState-in-effect: the server snapshot renders first (both sides
 * identical), then React swaps in the client snapshot right after hydration.
 * The value never changes within a page's lifetime, so subscribe is a no-op.
 */
import { useSyncExternalStore } from 'react';
import { lectorMode, type LectorMode } from './api-base';

const subscribe = () => () => {};

export function useLectorMode(): LectorMode | 'unknown' {
  return useSyncExternalStore(subscribe, lectorMode, () => 'unknown' as const);
}

export function useGithubLogin(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.__ENV__?.GITHUB_LOGIN === '1',
    () => false,
  );
}
