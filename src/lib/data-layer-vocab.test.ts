import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import { getAllVocab, updateVocabEntry } from './data-layer';
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

describe('vocab query cache', () => {
  it('deduplicates list reads and preserves parsed dates', async () => {
    apiFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 'vocab-1',
          stateUpdatedAt: '2026-07-12T00:00:00.000Z',
          createdAt: '2026-07-11T00:00:00.000Z',
        },
      ]),
    );

    const [first, second] = await Promise.all([getAllVocab(), getAllVocab()]);
    await getAllVocab();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(first[0].createdAt).toBeInstanceOf(Date);
    expect(second).toEqual(first);
  });

  it('invalidates every vocab read shape after a successful edit', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'vocab-1',
            stateUpdatedAt: '2026-07-12T00:00:00.000Z',
            createdAt: '2026-07-11T00:00:00.000Z',
          },
        ]),
      );

    await getAllVocab();
    await updateVocabEntry('vocab-1', { translation: 'updated' });
    await getAllVocab();

    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
});

describe('updateVocabEntry', () => {
  it('persists translation and state together', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await updateVocabEntry('vocab-1', { translation: 'updated meaning', state: 'level3' });

    expect(apiFetch).toHaveBeenCalledWith('/api/vocab/vocab-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ translation: 'updated meaning', state: 'level3' }),
    });
  });

  it('rejects with the API error instead of reporting a failed write as saved', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: 'storage unavailable' }, 503));

    await expect(updateVocabEntry('vocab-1', { translation: 'not persisted' })).rejects.toThrow(
      'storage unavailable',
    );
  });
});
