import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import { createCollection, createStandaloneLesson } from './data-layer';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => apiFetch.mockReset());

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
