import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import { createCollection, createStandaloneLesson, getAllCollections } from './data-layer';
import { clearQueryCache } from './query-cache';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  clearQueryCache();
});

describe('collection query cache', () => {
  it('deduplicates concurrent reads and reuses the tenant-language result', async () => {
    const collections = [{ id: 'collection-1', title: 'Cached' }];
    apiFetch.mockResolvedValueOnce(jsonResponse(collections));

    const [first, second] = await Promise.all([getAllCollections(), getAllCollections()]);
    const third = await getAllCollections();

    expect(first).toEqual(collections);
    expect(second).toEqual(collections);
    expect(third).toEqual(collections);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/collections?language=af');
  });

  it('invalidates the cached collection list only after a successful mutation', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse([{ id: 'old' }]))
      .mockResolvedValueOnce(jsonResponse({ id: 'new' }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'old' }, { id: 'new' }]));

    await getAllCollections();
    await createCollection({ title: 'New' });
    await expect(getAllCollections()).resolves.toEqual([{ id: 'old' }, { id: 'new' }]);
    expect(apiFetch).toHaveBeenCalledTimes(3);

    clearQueryCache();
    apiFetch.mockReset();
    apiFetch
      .mockResolvedValueOnce(jsonResponse([{ id: 'still-cached' }]))
      .mockResolvedValueOnce(jsonResponse({ error: 'write failed' }, 503));

    await getAllCollections();
    await expect(createCollection({ title: 'Rejected' })).rejects.toThrow('write failed');
    await expect(getAllCollections()).resolves.toEqual([{ id: 'still-cached' }]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

describe('plan-limited collection creation', () => {
  it('throws instead of returning an undefined id when collection creation is denied', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: 'plan_limit' }, 429));

    await expect(createCollection({ title: 'No room' })).rejects.toThrow('plan_limit');
  });

  it('removes a just-created standalone collection when its lesson is denied', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'collection-1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'plan_limit' }, 429))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await expect(
      createStandaloneLesson({ title: 'Large article', author: 'Author', textContent: 'text' }),
    ).rejects.toThrow('plan_limit');
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/api/collections/collection-1', {
      method: 'DELETE',
    });
  });
});
