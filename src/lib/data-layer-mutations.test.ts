import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import {
  blacklistClozeSentence,
  createGroup,
  deleteCollection,
  deleteJournalEntry,
  seedSentenceBank,
  setSetting,
  syncAnkiReviews,
  updateLesson,
  updateLessonProgress,
} from './data-layer';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => apiFetch.mockReset());

describe('user-triggered mutation failures', () => {
  it.each([
    ['collection', () => deleteCollection('collection-1')],
    ['lesson', () => updateLesson('lesson-1', { title: 'Updated' })],
    ['group', () => createGroup('Reading')],
    ['cloze', () => blacklistClozeSentence('cloze-1')],
    ['journal', () => deleteJournalEntry('entry-1')],
    ['setting', () => setSetting('timezone', 'Australia/Melbourne')],
  ])('rejects a failed %s write with the API error', async (kind, mutate) => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: `${kind} denied` }, 409));

    await expect(mutate()).rejects.toThrow(`${kind} denied`);
  });

  it('uses a useful fallback when the API does not return an error message', async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(deleteCollection('collection-1')).rejects.toThrow('Could not delete collection');
  });
});

describe('best-effort background mutations', () => {
  it('reports a progress-write failure without rejecting', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: 'offline' }, 502));

    await expect(updateLessonProgress('lesson-1', { percentComplete: 50 })).resolves.toBe(false);
  });

  it('treats sentence seeding and Anki sync failures as no-ops', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'offline' }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: 'offline' }, 502));

    await expect(seedSentenceBank()).resolves.toEqual({ seeded: 0, total: 0 });
    await expect(syncAnkiReviews()).resolves.toEqual({ connected: false, synced: 0 });
  });
});
