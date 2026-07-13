import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedQuery,
  clearQueryCache,
  clearTenantQueries,
  invalidateQueries,
  type QueryKey,
} from './query-cache';

const key = (tenant: string, language: string, scope = 'collections'): QueryKey => ({
  tenant,
  language,
  scope,
});

beforeEach(() => {
  clearQueryCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T00:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('cachedQuery', () => {
  it('deduplicates in-flight reads and reuses the resolved value within the TTL', async () => {
    let resolve!: (value: string[]) => void;
    const loader = vi.fn(
      () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
    );

    const first = cachedQuery(key('user-a', 'af'), loader);
    const second = cachedQuery(key('user-a', 'af'), loader);
    expect(loader).toHaveBeenCalledTimes(1);

    resolve(['book']);
    await expect(Promise.all([first, second])).resolves.toEqual([['book'], ['book']]);
    await expect(cachedQuery(key('user-a', 'af'), loader)).resolves.toEqual(['book']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('isolates both tenant and language namespaces', async () => {
    const loader = vi.fn(async () => `value-${loader.mock.calls.length}`);

    await expect(cachedQuery(key('user-a', 'af'), loader)).resolves.toBe('value-1');
    await expect(cachedQuery(key('user-a', 'de'), loader)).resolves.toBe('value-2');
    await expect(cachedQuery(key('user-b', 'af'), loader)).resolves.toBe('value-3');
    await expect(cachedQuery(key('user-a', 'af'), loader)).resolves.toBe('value-1');
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('bypasses caching when there is no resolved tenant', async () => {
    const loader = vi.fn(async () => 'fresh');
    await cachedQuery(null, loader);
    await cachedQuery(null, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('expires values and never caches rejected requests', async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('recovered')
      .mockResolvedValueOnce('refreshed');

    await expect(cachedQuery(key('user-a', 'af'), loader, 100)).rejects.toThrow('offline');
    await expect(cachedQuery(key('user-a', 'af'), loader, 100)).resolves.toBe('recovered');
    vi.advanceTimersByTime(101);
    await expect(cachedQuery(key('user-a', 'af'), loader, 100)).resolves.toBe('refreshed');
  });

  it('invalidates matched scopes and prevents an in-flight read from repopulating them', async () => {
    let resolve!: (value: string) => void;
    const slow = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const queryKey = key('user-a', 'af');
    const pending = cachedQuery(queryKey, slow);

    invalidateQueries({ tenant: 'user-a', scope: 'collections' });
    resolve('stale');
    await expect(pending).resolves.toBe('stale');

    const fresh = vi.fn(async () => 'fresh');
    await expect(cachedQuery(queryKey, fresh)).resolves.toBe('fresh');
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('can clear one tenant without evicting another', async () => {
    const loaderA = vi.fn(async () => 'a');
    const loaderB = vi.fn(async () => 'b');
    await cachedQuery(key('user-a', 'af'), loaderA);
    await cachedQuery(key('user-b', 'af'), loaderB);

    clearTenantQueries('user-a');
    await cachedQuery(key('user-a', 'af'), loaderA);
    await cachedQuery(key('user-b', 'af'), loaderB);

    expect(loaderA).toHaveBeenCalledTimes(2);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });
});
