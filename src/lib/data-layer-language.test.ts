import { describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(async () =>
    new Response(JSON.stringify({ totalKnownWords: 12 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
}));

vi.mock('./api-base', () => ({ apiFetch }));

import { getFluencyStats } from './data-layer';

describe('language-scoped stats requests', () => {
  it('uses the explicitly selected language for the fluency badge', async () => {
    const result = await getFluencyStats('de');

    expect(apiFetch).toHaveBeenCalledWith('/api/stats/fluency?language=de');
    expect(result.totalKnownWords).toBe(12);
  });
});
