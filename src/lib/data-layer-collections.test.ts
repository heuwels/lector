import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import {
  createCollection,
  createStandaloneLesson,
  deleteLesson,
  getAllCollections,
  getCollection,
  getLesson,
  updateCollection,
  updateLesson,
  updateLessonProgress,
} from './data-layer';
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

// The API scopes its by-id routes to a language, and falls back to the
// server-side `targetLanguage` setting when a request omits the param. A
// browser whose cached language differs from that setting then lists its
// library under one language and 404s every by-id read under the other, which
// bounced the collection page straight back to the library. Every
// language-scoped call must name the language the library was listed under.
describe('by-id calls name the active language', () => {
  beforeEach(() => {
    apiFetch.mockResolvedValue(jsonResponse({ id: 'x' }));
  });

  it('sends the language on a collection read', async () => {
    await getCollection('collection-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/collections/collection-1?language=af');
  });

  it('sends the language on a collection update', async () => {
    await updateCollection('collection-1', { title: 'Renamed' });
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/collections/collection-1?language=af',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('sends the language on a lesson read', async () => {
    await getLesson('lesson-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/lessons/lesson-1?language=af');
  });

  it('sends the language on a lesson update', async () => {
    await updateLesson('lesson-1', { title: 'Renamed' });
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/lessons/lesson-1?language=af',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('sends the language on a lesson delete', async () => {
    await deleteLesson('lesson-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/lessons/lesson-1?language=af', {
      method: 'DELETE',
    });
  });

  it('sends the language on a progress write', async () => {
    await updateLessonProgress('lesson-1', { percentComplete: 12 });
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/lessons/lesson-1/progress?language=af',
      expect.objectContaining({ method: 'PUT' }),
    );
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
    // The rollback carries the language param like every other by-id call:
    // without it the API resolves the language from the server-side setting,
    // which 404s the rollback whenever that setting and this browser's cached
    // language disagree.
    expect(apiFetch).toHaveBeenNthCalledWith(3, '/api/collections/collection-1?language=af', {
      method: 'DELETE',
    });
  });
});
