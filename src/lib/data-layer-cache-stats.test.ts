import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => 'local',
  readLanguageCache: () => 'af',
}));

import {
  getAllDailyStats,
  getAppWideActivity,
  getFluencyStats,
  getReadingStats,
  incrementDailyStat,
  updateLessonProgress,
  updateWordState,
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

describe('stats query caches', () => {
  it('separates language-scoped stats from tenant-wide activity', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse([{ date: '2026-07-12', points: 2 }]))
      .mockResolvedValueOnce(jsonResponse([{ date: '2026-07-12', minutesRead: 3 }]));

    const daily = await getAllDailyStats();
    const activity = await getAppWideActivity();
    await getAllDailyStats();
    await getAppWideActivity();

    expect(daily).toEqual([{ date: '2026-07-12', points: 2 }]);
    expect(activity).toEqual([{ date: '2026-07-12', minutesRead: 3 }]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/stats?language=af');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/stats/activity');
  });

  it('keys an explicit fluency language independently from the active language', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ totalKnownWords: 10 }))
      .mockResolvedValueOnce(jsonResponse({ totalKnownWords: 20 }));

    await expect(getFluencyStats('af')).resolves.toMatchObject({ totalKnownWords: 10 });
    await expect(getFluencyStats('de')).resolves.toMatchObject({ totalKnownWords: 20 });
    await expect(getFluencyStats('af')).resolves.toMatchObject({ totalKnownWords: 10 });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/stats/fluency?language=af');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/stats/fluency?language=de');
  });

  it('invalidates daily stats after a successful counter mutation', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse([{ date: '2026-07-12', points: 1 }]))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ date: '2026-07-12', points: 2 }]));

    await getAllDailyStats();
    await incrementDailyStat('points');
    await expect(getAllDailyStats()).resolves.toEqual([{ date: '2026-07-12', points: 2 }]);
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it('invalidates fluency after known-word writes', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ totalKnownWords: 1 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ totalKnownWords: 2 }));

    await getFluencyStats();
    await updateWordState('huis', 'known');
    await expect(getFluencyStats()).resolves.toMatchObject({ totalKnownWords: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it('invalidates reading aggregates after successful progress writes', async () => {
    apiFetch
      .mockResolvedValueOnce(jsonResponse({ completedBooks: 0 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ completedBooks: 1 }));

    await getReadingStats();
    await updateLessonProgress('lesson-1', { percentComplete: 100 });
    await expect(getReadingStats()).resolves.toMatchObject({ completedBooks: 1 });
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
});
