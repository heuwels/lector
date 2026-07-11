import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(
    async () =>
      new Response(JSON.stringify({ totalKnownWords: 12 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
}));

vi.mock('./api-base', () => ({ apiFetch }));

import { getFluencyStats, updateClozeAfterReview } from './data-layer';

beforeEach(() => {
  apiFetch.mockClear();
});

describe('language-scoped stats requests', () => {
  it('uses the explicitly selected language for the fluency badge', async () => {
    const result = await getFluencyStats('de');

    expect(apiFetch).toHaveBeenCalledWith('/api/stats/fluency?language=de');
    expect(result.totalKnownWords).toBe(12);
  });
});

describe('language-scoped cloze requests', () => {
  it('pins review writes to the same active language used to load the card', async () => {
    const nextReview = new Date('2026-07-12T00:00:00.000Z');

    await updateClozeAfterReview('card-1', true, 25, nextReview);

    expect(apiFetch).toHaveBeenCalledWith('/api/cloze/card-1/review?language=af', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correct: true,
        masteryLevel: 25,
        nextReview: nextReview.toISOString(),
      }),
    });
  });
});
