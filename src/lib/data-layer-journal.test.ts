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
  it('rejects a plan-limited create instead of returning an undefined id', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'plan_limit', metric: 'journalWordsPerMonth' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(createJournalEntry('too many words')).rejects.toThrow(
      'This entry exceeds your monthly journal allowance.',
    );
  });

  it('rejects a plan-limited draft update so submit cannot continue to correction', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'plan_limit', metric: 'journalWordsPerMonth' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(updateJournalDraft('entry-1', 'too many words')).rejects.toThrow(
      'This edit exceeds your monthly journal allowance.',
    );
  });
});
