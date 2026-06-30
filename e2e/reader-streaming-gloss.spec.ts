import { test, expect, Page } from '@playwright/test';

/**
 * Two-tier word translation on the reader (issue: translation latency).
 *
 * Clicking a word that misses the on-device dictionary should:
 *   1. stream a fast plain-text gloss into the drawer (POST /api/translate/gloss)
 *   2. offer an "Enrich" button that fetches the rich entry — senses, IPA,
 *      etymology, related forms (POST /api/translate/enrich)
 *
 * Both LLM endpoints are mocked so we assert the wiring, not the model. The
 * dictionary lookup is forced to a miss so the AI path is deterministic.
 */

const GLOSS = 'seagull';
const TITLE = 'Streaming Gloss Test';

async function setupMocks(page: Page) {
  // Force a dictionary miss so the click always falls through to the AI path.
  await page.route('**/api/dictionary/lookup*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entry: null }),
    });
  });

  // Fast path: plain-text gloss (the client reads it via a stream reader).
  await page.route('**/api/translate/gloss', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: GLOSS });
  });

  // Enrich path: the rich structured entry.
  await page.route('**/api/translate/enrich', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        translation: GLOSS,
        partOfSpeech: 'noun',
        word: 'seemeeu',
        senses: [{ partOfSpeech: 'noun', gloss: GLOSS }],
        ipa: '/ˈseː.mɪːu/',
        etymology: 'From Afrikaans see (sea) plus meeu (gull).',
        relatedForms: [{ form: 'seemeeue', relation: 'plural of' }],
      }),
    });
  });
}

async function importLesson(page: Page): Promise<string> {
  const colRes = await page.request.post('http://localhost:3457/api/collections', {
    data: { title: TITLE, language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(`http://localhost:3457/api/collections/${collectionId}/lessons`, {
    data: {
      title: 'Hoofstuk 1',
      textContent: 'By die see sien sy n seemeeu wat oor die water vlieg.',
    },
  });

  const lessonsRes = await page.request.get(`http://localhost:3457/api/collections/${collectionId}/lessons`);
  const lessons = await lessonsRes.json();
  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('seemeeu')).toBeVisible({ timeout: 10000 });
  return collectionId;
}

test.describe('Reader — streamed gloss + enrich', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupMocks(page);

    // Clean leftovers from a prior run.
    const res = await page.request.get('http://localhost:3457/api/collections');
    for (const c of await res.json()) {
      if (c.title === TITLE) await page.request.delete(`http://localhost:3457/api/collections/${c.id}`);
    }
    const vocabRes = await page.request.get('http://localhost:3457/api/vocab?text=seemeeu');
    for (const v of await vocabRes.json()) {
      await page.request.delete(`http://localhost:3457/api/vocab/${v.id}`);
    }

    collectionId = await importLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(`http://localhost:3457/api/collections/${collectionId}`);
  });

  test('streams a gloss, then enriches to the full entry', async ({ page }) => {
    const word = page.locator('article span.cursor-pointer', { hasText: 'seemeeu' });
    await expect(word).toBeVisible();
    await word.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Tier 1: the streamed gloss is shown.
    await expect(drawer.getByText(GLOSS, { exact: false })).toBeVisible({ timeout: 5000 });

    // It's an AI result, not an on-device dict hit.
    await expect(drawer.getByText('on-device')).toHaveCount(0);

    // Tier 2: Enrich is offered for the bare gloss.
    const enrich = drawer.getByRole('button', { name: 'Enrich' });
    await expect(enrich).toBeVisible();
    await enrich.click();

    // Rich fields appear after enrichment.
    await expect(drawer.getByText('Etymology')).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('From Afrikaans see', { exact: false })).toBeVisible();
    await expect(drawer.getByText('Related forms')).toBeVisible();
    await expect(drawer.getByText('seemeeue')).toBeVisible();

    // Once enriched, the Enrich affordance is gone.
    await expect(enrich).toHaveCount(0);
  });

  test('gloss result is not flagged as an on-device dictionary hit', async ({ page }) => {
    const word = page.locator('article span.cursor-pointer', { hasText: 'seemeeu' });
    await word.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByText(GLOSS, { exact: false })).toBeVisible({ timeout: 5000 });

    // The "AI" source pill should show, not "on-device" or "learned".
    await expect(drawer.getByText('on-device')).toHaveCount(0);
    await expect(drawer.getByText('learned')).toHaveCount(0);
  });
});

/**
 * Guard against the easy mistake of calling a Hono route that isn't actually
 * wired. The UI specs above mock these endpoints, so an unwired route would
 * pass there but fail in the real app. Here we hit the REAL Hono API (directly,
 * now that the Next /api proxy is gone — #188) with no word: a wired route
 * validates and replies 400; an unwired path 404s. No LLM call (rejected at
 * validation), so it's safe in CI.
 */
test.describe('translate routes are wired', () => {
  for (const path of [
    'http://localhost:3457/api/translate/gloss',
    'http://localhost:3457/api/translate/enrich',
  ]) {
    test(`${path} reaches Hono (not 404)`, async ({ request }) => {
      const res = await request.post(path, { data: { language: 'af' } });
      expect(res.status(), `${path} should reach Hono, not be an unwired route`).toBe(400);
    });
  }
});
