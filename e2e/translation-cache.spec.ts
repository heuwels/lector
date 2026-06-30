import { test, expect, Page, Route } from '@playwright/test';
import { apiUrl } from './api';

/**
 * E2E for issue #100 — accepted AI translations get cached into the on-device
 * dictionary so the next time the user clicks the same word, lookup is served
 * from cache (`learned` pill) and the AI translate API is NOT called.
 *
 * Strategy:
 *   1. Import a book with a known nonsense token that's guaranteed to miss
 *      the on-device dict (and isn't a real Afrikaans word).
 *   2. Mock /api/translate/gloss (the streamed fast path) with a deterministic
 *      response; assert exactly ONE call across the test.
 *   3. Click the word, mark it Known (an accept action) — the gloss is cached
 *      as a single sense.
 *   4. Re-click the same word — the drawer must show the `learned` source pill
 *      and the AI mock must still report exactly one total invocation.
 */
async function importBookWithToken(page: Page, token: string) {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Cache Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: {
      title: 'Cap. 1',
      // Surround the token with normal Afrikaans so the tokenizer treats it
      // as one clickable word.
      textContent: `Die ${token} is hier.`,
    },
  });
  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();
  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  return collectionId;
}

test.describe('AI translation cache', () => {
  // Use a unique nonsense word per test run so we never collide with a real
  // dict entry, and so the cache is empty for the first click.
  const NONSENSE = `xqzzaftj${Date.now().toString(36)}`;
  let collectionId: string;
  let glossCallCount = 0;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    glossCallCount = 0;

    // The read page streams a plain-text gloss for a dict miss; that gloss is
    // what gets cached (as a single sense) when the user accepts it.
    await page.route('**/api/translate/gloss', async (route: Route) => {
      glossCallCount++;
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'invented; made-up' });
    });

    // Phrase + legacy structured word path — not exercised by the bare-gloss
    // accept flow, but stubbed so a stray call never hits the network.
    await page.route('**/api/translate', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translation: '[ai phrase]', partOfSpeech: 'phrase' }),
      });
    });

    // Clean any leftover Cache Test collections
    const res = await page.request.get(apiUrl('/api/collections'));
    const cols = await res.json();
    for (const c of cols) {
      if (c.title === 'Cache Test') {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }

    collectionId = await importBookWithToken(page, NONSENSE);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
    // Clean the cache table so subsequent runs aren't polluted. There's no
    // dedicated DELETE endpoint yet; do it via raw SQL through the data
    // import/export route would be too heavy. Just leave it — the unique
    // NONSENSE word per run guarantees no cross-test interference.
  });

  test('AI translation persists to cache on accept and is served on re-click', async ({ page }) => {
    // 1st click — should hit the AI mock once.
    const word = page.locator('article span.cursor-pointer', { hasText: NONSENSE });
    await expect(word).toBeVisible();
    await word.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByText('AI', { exact: true })).toBeVisible({ timeout: 5000 });
    expect(glossCallCount).toBe(1);

    // Accept via "Known" — this should fire-and-forget the cache write.
    await drawer.getByRole('button', { name: /Known/ }).click();

    // Drawer closes on Known. Give the cache write a beat to land before
    // the next lookup. Polling on the API directly is faster than waitForTimeout.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(
            apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(NONSENSE)}`),
          );
          const data = await r.json();
          return data.entry?.source ?? null;
        },
        { timeout: 5000 },
      )
      .toBe('cache');

    // 2nd click — must come from the cache, must NOT call AI again.
    await word.click();
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByText('learned', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(drawer.locator('ol li').first()).toBeVisible();
    expect(glossCallCount).toBe(1);
  });
});
