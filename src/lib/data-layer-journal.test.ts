import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({
  apiFetch,
  lectorMode: () => 'selfhost',
}));

import { createJournalEntry, updateJournalDraft } from './data-layer';

beforeEach(() => {
  apiFetch.mockReset();
});

describe('journal write failures', () => {
  it('returns the plan-limited create response for the caller to inspect', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'plan_limit', metric: 'journalWordsPerMonth' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await createJournalEntry('too many words');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });

  it('returns the plan-limited update response for the caller to inspect', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'plan_limit', metric: 'journalWordsPerMonth' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await updateJournalDraft('entry-1', 'too many words');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
  });
});
