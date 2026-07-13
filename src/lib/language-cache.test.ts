import { describe, it, expect, beforeEach, vi } from 'vitest';

// The tenant-keyed target-language cache (#281). The module keeps the cloud
// tenant in module state, so every test re-imports a fresh copy; `window` is
// stubbed per test in the api-base.test.ts style (node environment).

const LEGACY = 'lector-target-language';

type Stored = Map<string, string>;

function fakeWindow(mode: 'selfhost' | 'cloud', stored: Stored) {
  const dispatched: Event[] = [];
  const win = {
    __ENV__: { LECTOR_MODE: mode },
    localStorage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    },
    dispatchEvent: (e: Event) => {
      dispatched.push(e);
      return true;
    },
  };
  (globalThis as unknown as { window?: unknown }).window = win;
  return { dispatched };
}

function clearWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

async function freshModule() {
  vi.resetModules();
  return import('./language-cache');
}

beforeEach(() => {
  clearWindow();
  delete process.env.LECTOR_MODE;
});

describe('selfhost — the single implicit tenant', () => {
  it('round-trips through the :local key', async () => {
    const stored: Stored = new Map();
    fakeWindow('selfhost', stored);
    const cache = await freshModule();

    cache.writeLanguageCache('de');
    expect(stored.get(`${LEGACY}:local`)).toBe('de');
    expect(cache.readLanguageCache()).toBe('de');
    expect(stored.has(LEGACY)).toBe(false);
  });

  it('renames a legacy unkeyed value to :local on first touch (e2e seeds keep working)', async () => {
    const stored: Stored = new Map([[LEGACY, 'af']]);
    fakeWindow('selfhost', stored);
    const cache = await freshModule();

    expect(cache.readLanguageCache()).toBe('af');
    expect(stored.get(`${LEGACY}:local`)).toBe('af');
    expect(stored.has(LEGACY)).toBe(false);
  });

  it('lets a fresh legacy write win over the keyed value (downgrade→upgrade, e2e drivers)', async () => {
    // Post-migration, only an OLDER app version writes the unkeyed key — and
    // that write is the user's most recent choice, so it supersedes the
    // keyed value left behind by the newer version.
    const stored: Stored = new Map([
      [LEGACY, 'af'],
      [`${LEGACY}:local`, 'nl'],
    ]);
    fakeWindow('selfhost', stored);
    const cache = await freshModule();

    expect(cache.readLanguageCache()).toBe('af');
    expect(stored.has(LEGACY)).toBe(false);
  });
});

describe('cloud — per-account namespaces', () => {
  it('reads null before a session resolves, even with stale browser state (#281 repro)', async () => {
    // The exact repro: the browser carries a pre-flip legacy value AND
    // another account's keyed value. A fresh account must see neither.
    const stored: Stored = new Map([
      [LEGACY, 'af'],
      [`${LEGACY}:user-a`, 'de'],
    ]);
    fakeWindow('cloud', stored);
    const cache = await freshModule();

    expect(cache.readLanguageCache()).toBeNull();
    // The legacy leak artifact is gone; the other account's key is untouched.
    expect(stored.has(LEGACY)).toBe(false);
    expect(stored.get(`${LEGACY}:user-a`)).toBe('de');
  });

  it('drops writes with no tenant rather than polluting a shared key', async () => {
    const stored: Stored = new Map();
    fakeWindow('cloud', stored);
    const cache = await freshModule();

    cache.writeLanguageCache('es');
    expect(stored.size).toBe(0);
  });

  it('keeps alternating accounts fully independent in one browser', async () => {
    const stored: Stored = new Map();
    fakeWindow('cloud', stored);
    const cache = await freshModule();

    cache.setActiveTenant('user-a');
    cache.writeLanguageCache('de');
    expect(cache.readLanguageCache()).toBe('de');

    cache.setActiveTenant('user-b');
    expect(cache.readLanguageCache()).toBeNull(); // fresh account: no inherited language
    cache.writeLanguageCache('fr');
    expect(cache.readLanguageCache()).toBe('fr');

    cache.setActiveTenant('user-a');
    expect(cache.readLanguageCache()).toBe('de');
    expect(stored.get(`${LEGACY}:user-a`)).toBe('de');
    expect(stored.get(`${LEGACY}:user-b`)).toBe('fr');
  });

  it('a stale legacy value never surfaces for a logged-in account', async () => {
    const stored: Stored = new Map([[LEGACY, 'af']]);
    fakeWindow('cloud', stored);
    const cache = await freshModule();

    cache.setActiveTenant('user-new');
    expect(cache.readLanguageCache()).toBeNull();
  });

  it('announces tenant changes (microtask) exactly once per change', async () => {
    const stored: Stored = new Map();
    const { dispatched } = fakeWindow('cloud', stored);
    const cache = await freshModule();

    cache.setActiveTenant('user-a');
    cache.setActiveTenant('user-a'); // idempotent — render-time call site
    await Promise.resolve(); // flush microtasks
    expect(dispatched.filter((e) => e.type === 'lector-language-change')).toHaveLength(1);

    cache.setActiveTenant('user-b');
    await Promise.resolve();
    expect(dispatched.filter((e) => e.type === 'lector-language-change')).toHaveLength(2);
  });

  it('clears in-memory queries when the active account changes', async () => {
    const stored: Stored = new Map();
    fakeWindow('cloud', stored);
    const cache = await freshModule();
    const queries = await import('./query-cache');
    const loader = vi.fn(async () => 'account-a data');
    const key = { tenant: 'user-a', language: 'de', scope: 'collections' };

    cache.setActiveTenant('user-a');
    await queries.cachedQuery(key, loader);
    await queries.cachedQuery(key, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    cache.setActiveTenant('user-b');
    await queries.cachedQuery(key, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('SSR', () => {
  it('reads null and swallows writes with no window', async () => {
    const cache = await freshModule();
    expect(cache.readLanguageCache()).toBeNull();
    expect(() => cache.writeLanguageCache('de')).not.toThrow();
  });
});
