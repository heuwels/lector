/**
 * The target-language cache, keyed by tenant (#281).
 *
 * `lector-target-language` used to be a single browser-scoped localStorage
 * key. In cloud that leaks across accounts: SetupGuard trusted any cached
 * value, so a fresh account in a previously-used browser inherited whatever
 * language the browser last used, skipped /setup, and read/wrote rows under
 * a language it never chose — while its real server-side `targetLanguage`
 * setting (the source of truth) was never written.
 *
 * The cache is now per-tenant — `lector-target-language:<tenant>` — and only
 * ever a cache in front of the server setting:
 *
 *  - selfhost: the constant 'local' tenant (mirrors LOCAL_USER_ID server-side)
 *    keeps one code path and today's behaviour; a legacy unkeyed value is
 *    renamed to the ':local' key on first touch, which also keeps existing
 *    e2e localStorage seeds working.
 *  - cloud: the session user's id, recorded by AuthGuard's CloudSessionGate
 *    at render time — parents render before children, so the tenant is set
 *    before any gated component (SetupGuard included) can read the cache.
 *    Until a session resolves, reads return null (never another tenant's
 *    value). A legacy unkeyed key in cloud is precisely the #281 leak
 *    artifact, so it is deleted on first touch.
 */

import { lectorMode } from './api-base';
import { LANGUAGE_CHANGE_EVENT } from '@/constants/storage';

const LEGACY_KEY = 'lector-target-language';

let cloudTenant: string | null = null;

/**
 * Record the cloud session's user id as the active cache tenant. Called from
 * CloudSessionGate during render — idempotent, so re-renders are free; on an
 * actual change the language-change event is dispatched in a microtask (not
 * synchronously — we may be mid-render) so components outside the session
 * gate re-read their snapshots under the new namespace.
 */
export function setActiveTenant(userId: string): void {
  if (cloudTenant === userId) return;
  cloudTenant = userId;
  if (typeof window !== 'undefined') {
    queueMicrotask(() => window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT)));
  }
}

function tenantId(): string | null {
  if (lectorMode() === 'selfhost') return 'local';
  return cloudTenant;
}

function keyFor(tenant: string): string {
  return `${LEGACY_KEY}:${tenant}`;
}

/**
 * Absorb the pre-#281 unkeyed value. Selfhost moves it onto the ':local' key
 * — and legacy WINS over an existing keyed value, because after this rename
 * the only writer of the unkeyed key is an older app version (a downgrade),
 * whose write is by definition the user's most recent choice. (This is also
 * what lets e2e specs keep driving the language via the plain key.) Cloud
 * deletes it without reading: it was written either by another account or by
 * the pre-flip gated app, and trusting it is exactly the #281 leak.
 */
function migrateLegacyKey(): void {
  const legacy = window.localStorage.getItem(LEGACY_KEY);
  if (legacy === null) return;
  if (lectorMode() === 'selfhost') {
    window.localStorage.setItem(keyFor('local'), legacy);
  }
  window.localStorage.removeItem(LEGACY_KEY);
}

/**
 * The current tenant's cached language, or null when there is nothing cached
 * — or no tenant to read for (SSR, or cloud before the session resolves).
 */
export function readLanguageCache(): string | null {
  if (typeof window === 'undefined') return null;
  migrateLegacyKey();
  const tenant = tenantId();
  if (!tenant) return null;
  return window.localStorage.getItem(keyFor(tenant));
}

/** Cache the current tenant's language. A no-op with no tenant to write for. */
export function writeLanguageCache(code: string): void {
  if (typeof window === 'undefined') return;
  migrateLegacyKey();
  const tenant = tenantId();
  if (!tenant) return;
  window.localStorage.setItem(keyFor(tenant), code);
}
