import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import { updateVocabEntry } from './data-layer';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => apiFetch.mockReset());

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
