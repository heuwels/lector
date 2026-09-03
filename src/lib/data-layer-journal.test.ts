import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({
  apiFetch,
  lectorMode: () => 'selfhost',
}));

import { createJournalEntry, saveJournalEntry, updateJournalDraft } from './data-layer';

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

  it('saves a submitted entry without calling the correct route', async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const response = await saveJournalEntry('entry-1', 'saved text');
    expect(response.ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/journal\/entry-1/);
    expect(url).not.toMatch(/correct/);
    expect(JSON.parse(String(init.body))).toEqual({ body: 'saved text', status: 'submitted' });
  });
});
