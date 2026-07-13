/**
 * Small in-memory read-through cache for API query helpers.
 *
 * Callers must supply an explicit tenant and, for language-scoped data, an
 * explicit language. A null key bypasses caching entirely; cloud reads before
 * session resolution therefore cannot create or consume a browser-global
 * entry. Values live for 30 seconds, concurrent reads share one promise, and
 * invalidation also prevents an already-running request from repopulating a
 * key after a successful mutation.
 */

export interface QueryKey {
  scope: string;
  tenant: string;
  language?: string;
  params?: readonly (boolean | null | number | string)[];
}

export type QueryMatch = Partial<Pick<QueryKey, 'scope' | 'tenant' | 'language'>>;

interface QueryEntry {
  key: QueryKey;
  expiresAt: number;
  hasValue: boolean;
  value?: unknown;
  promise?: Promise<unknown>;
}

const DEFAULT_TTL_MS = 30_000;
const entries = new Map<string, QueryEntry>();

function serializeKey(key: QueryKey): string {
  return JSON.stringify([key.tenant, key.language ?? null, key.scope, key.params ?? []]);
}

export function cachedQuery<T>(
  key: QueryKey | null,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  if (key === null) return loader();

  const serialized = serializeKey(key);
  const existing = entries.get(serialized);
  if (existing?.promise) return existing.promise as Promise<T>;
  if (existing?.hasValue && existing.expiresAt > Date.now()) {
    return Promise.resolve(existing.value as T);
  }

  const promise = loader().then(
    (value) => {
      const current = entries.get(serialized);
      if (current?.promise === promise) {
        entries.set(serialized, {
          key,
          expiresAt: Date.now() + Math.max(0, ttlMs),
          hasValue: true,
          value,
        });
      }
      return value;
    },
    (error: unknown) => {
      if (entries.get(serialized)?.promise === promise) entries.delete(serialized);
      throw error;
    },
  );

  entries.set(serialized, { key, expiresAt: 0, hasValue: false, promise });
  return promise;
}

export function invalidateQueries(match: QueryMatch): void {
  for (const [serialized, entry] of entries) {
    if (match.scope !== undefined && entry.key.scope !== match.scope) continue;
    if (match.tenant !== undefined && entry.key.tenant !== match.tenant) continue;
    if (match.language !== undefined && entry.key.language !== match.language) continue;
    entries.delete(serialized);
  }
}

export function clearTenantQueries(tenant: string): void {
  invalidateQueries({ tenant });
}

export function clearQueryCache(): void {
  entries.clear();
}
