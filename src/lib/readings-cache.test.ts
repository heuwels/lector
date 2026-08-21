import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedQuery, clearQueryCache } from './query-cache';

// The readings fetch used to answer `{}` on a failed response. That is
// indistinguishable from a lesson with no readings, so the cache stored it as a
// real result and the reader drew no ruby until it remounted. These pin the
// caching contract that makes a retry possible.
describe('a failed query is not cached as a result', () => {
  const key = { tenant: 'local', language: 'ja', scope: 'readings', params: ['lesson', 'x'] };

  beforeEach(() => clearQueryCache());

  it('caches a successful answer', async () => {
    const loader = vi.fn().mockResolvedValue({ 本: 'ほん' });
    expect(await cachedQuery(key, loader)).toEqual({ 本: 'ほん' });
    expect(await cachedQuery(key, loader)).toEqual({ 本: 'ほん' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  // The behaviour the fix depends on. A rejection must drop the entry, so the
  // next attempt asks again instead of reading a failure back.
  it('asks again after a rejection', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ 本: 'ほん' });

    await expect(cachedQuery(key, loader)).rejects.toThrow('boom');
    expect(await cachedQuery(key, loader)).toEqual({ 本: 'ほん' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  // An empty answer is still a real answer: an all-kana Japanese lesson has no
  // readings to print. It caches, and the reader's own refetch covers the case
  // where it was empty only because a deploy had not landed.
  it('caches an empty answer, because empty can be correct', async () => {
    const loader = vi.fn().mockResolvedValue({});
    expect(await cachedQuery(key, loader)).toEqual({});
    expect(await cachedQuery(key, loader)).toEqual({});
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('expires so a later read asks again', async () => {
    const loader = vi.fn().mockResolvedValue({});
    await cachedQuery(key, loader, 0);
    await cachedQuery(key, loader, 0);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
