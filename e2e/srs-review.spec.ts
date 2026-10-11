import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * E2E for the Practice "SRS Review" mode (levels 1-7 saved-word review).
 *
 * The round is scoped to a private lesson via the Book ID filter, so the queue
 * cannot pick up rows other specs seeded into the shared e2e database. Seeding
 * a saved word at `state: 'level1'` is enough to make it due: a word that has
 * never been reviewed has no `next_review`, and the queue treats that as due.
 */

const TRANSLATIONS: Record<string, string> = {
  srsappel: 'apple',
  srshond: 'dog',
  srskaas: 'cheese',
  srstafel: 'table',
};

async function seedLesson(page: Page): Promise<{ collectionId: string; lessonId: string }> {
  const stamp = Date.now().toString(36);
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: `SRS ${stamp}`, language: 'af' },
  });
  const { id: collectionId } = (await colRes.json()) as { id: string };
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: { title: 'SRS words', textContent: Object.keys(TRANSLATIONS).join(' ') },
  });
  const lessons = (await (
    await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
  ).json()) as Array<{ id: string }>;
  const lessonId = lessons[0].id;

  for (const [text, translation] of Object.entries(TRANSLATIONS)) {
    const id = `e2e-srs-${stamp}-${text}`;
    await page.request.post(apiUrl('/api/vocab'), {
      data: {
        id,
        text,
        type: 'word',
        sentence: `Die ${text} is hier.`,
        translation,
        state: 'level1',
        stateUpdatedAt: new Date().toISOString(),
        reviewCount: 0,
        bookId: lessonId,
        createdAt: new Date().toISOString(),
        pushedToAnki: false,
        language: 'af',
      },
    });
  }

  return { collectionId, lessonId };
}

test.describe('SRS Review', () => {
  test.beforeEach(async ({ page }) => {
    // public/__env.js is an empty stub, so the browser falls back to the API on
    // :3457 — the same origin these specs use in a default run. When the suite
    // runs on alternate ports (e.g. a dev server already holds 3457), pin
    // window.__ENV__.API_URL to API_BASE so the browser and the specs agree.
    const apiBase = apiUrl('');
    await page.route('**/__env.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.__ENV__ = { API_URL: ${JSON.stringify(apiBase)} };`,
      }),
    );
  });

  test('reviews due saved words and advances on the correct answer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { collectionId, lessonId } = await seedLesson(page);

    try {
      await page.goto('/practice');
      const srsTab = page.getByRole('button', { name: 'SRS Review', exact: true });
      await expect(srsTab).toBeVisible({ timeout: 30000 });

      await srsTab.click();
      await page.getByPlaceholder('Enter book ID...').fill(lessonId);
      await page.getByRole('button', { name: 'Start SRS Review' }).click();

      const card = page.getByTestId('srs-word');
      await expect(card).toBeVisible({ timeout: 15000 });

      for (let step = 0; step < Object.keys(TRANSLATIONS).length; step++) {
        const word = (await card.textContent())?.trim() ?? '';
        const gloss = TRANSLATIONS[word];
        expect(gloss, `unexpected SRS word "${word}"`).toBeTruthy();

        await page.getByTestId('srs-mc-option').filter({ hasText: gloss }).click();

        // The card advances (or the round completes) after the answer delay.
        await page.waitForFunction(
          (previous) => {
            if (document.querySelector('[data-testid="srs-complete"]')) return true;
            const current = document.querySelector('[data-testid="srs-word"]');
            return !!current && current.textContent?.trim() !== previous;
          },
          word,
          { timeout: 6000 },
        );
      }

      await expect(page.getByTestId('srs-complete')).toBeVisible({ timeout: 10000 });
    } finally {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });
});
