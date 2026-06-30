import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * Nested definitions in the dictionary drawer (issue #106).
 *
 * Form-of glosses ("plural of vrug") render the referenced word as a link;
 * clicking it re-targets the drawer to the underlying word so it can be
 * inspected and marked known. Runs through the reader, exercising the full
 * lookup pipeline: dict hit → nested dict hit, and nested dict miss → AI.
 */

const COLLECTION_TITLE = 'Nested Defs Test';
const LESSON_TEXT = 'Die vrugte is baie lekker. Die pond is swaar.';
const TEST_WORDS = ['vrug', 'vrugte', 'pond'];

/** GET /api/vocab has no text filter — fetch all and match client-side. */
async function vocabByText(page: Page, text: string): Promise<Array<{ id: string; text: string; state: string }>> {
  const res = await page.request.get(apiUrl('/api/vocab'));
  if (!res.ok()) return [];
  const all = (await res.json()) as Array<{ id: string; text: string; state: string }>;
  return all.filter((v) => v.text === text);
}

async function cleanupVocab(page: Page, texts: string[]) {
  const res = await page.request.get(apiUrl('/api/vocab'));
  if (!res.ok()) return;
  for (const v of (await res.json()) as Array<{ id: string; text: string }>) {
    if (texts.includes(v.text)) {
      await page.request.delete(apiUrl(`/api/vocab/${v.id}`));
    }
  }
}

async function importLesson(page: Page): Promise<string> {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: COLLECTION_TITLE, language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: { title: 'Hoofstuk 1', textContent: LESSON_TEXT },
  });

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('vrugte')).toBeVisible({ timeout: 10000 });
  return collectionId;
}

function readerWord(page: Page, word: string) {
  return page.locator('article span.cursor-pointer', { hasText: word }).first();
}

test.describe('Nested dictionary definitions (reader)', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // AI fallback stub — only consulted when the dict misses.
    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          translation: `[translated: ${body.word}]`,
          partOfSpeech: 'noun',
        }),
      });
    });

    // A dict-miss word (incl. a nested lookup that misses) now streams its gloss
    // from /translate/gloss as plain text rather than the structured endpoint.
    await page.route('**/api/translate/gloss', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'text/plain', body: `[translated: ${body.word}]` });
    });

    // Remove leftovers from aborted runs
    const res = await page.request.get(apiUrl('/api/collections'));
    for (const c of await res.json()) {
      if (c.title === COLLECTION_TITLE) {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }
    await cleanupVocab(page, TEST_WORDS);

    collectionId = await importLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    await cleanupVocab(page, TEST_WORDS);
  });

  test('clicking the word inside "plural of vrug" opens vrug and can mark it known', async ({ page }) => {
    await readerWord(page, 'vrugte').click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading', { name: 'vrugte', exact: true })).toBeVisible();

    // The form-of gloss renders its target word as a link
    const nested = drawer.getByTestId('nested-word-link');
    await expect(nested).toHaveText('vrug', { timeout: 5000 });
    await expect(drawer.getByText('plural of')).toBeVisible();

    // The clicked word occurs in the sentence, so in-context AI is offered
    await expect(drawer.getByRole('button', { name: 'In context' })).toBeVisible();

    await nested.click();

    // Drawer re-targets to the underlying word, served by the dict
    await expect(drawer.getByRole('heading', { name: 'vrug', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('A fruit.')).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('on-device')).toBeVisible();

    // The sentence the user was reading is kept for context/provenance...
    await expect(drawer.locator('p', { hasText: 'vrugte' })).toBeVisible();

    // ...but in-context AI is NOT offered: "vrug" itself does not occur in
    // "Die vrugte is baie lekker." — the sentence belongs to the parent word.
    await expect(drawer.getByRole('button', { name: 'In context' })).not.toBeVisible();

    // The underlying word can be marked known directly
    await drawer.getByRole('button', { name: '✓ Known' }).click();
    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 5000 });

    const entries = await vocabByText(page, 'vrug');
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe('known');

    // ...and the surface form the user clicked first was not saved as a side effect
    expect(await vocabByText(page, 'vrugte')).toHaveLength(0);
  });

  test('nested word falls back to AI translate when the dict misses it', async ({ page }) => {
    // Force a dict miss for the UNDERLYING word only — "vrugte" still resolves.
    await page.route(
      (url) => url.pathname.endsWith('/api/dictionary/lookup') && url.searchParams.get('word') === 'vrug',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ entry: null }),
        });
      },
    );

    await readerWord(page, 'vrugte').click();

    const drawer = page.getByTestId('translation-drawer');
    const nested = drawer.getByTestId('nested-word-link');
    await expect(nested).toHaveText('vrug', { timeout: 5000 });
    await nested.click();

    await expect(drawer.getByRole('heading', { name: 'vrug', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated: vrug]')).toBeVisible({ timeout: 5000 });

    // AI source pill, not the on-device one
    await expect(drawer.getByText('AI', { exact: true })).toBeVisible();
    await expect(drawer.getByText('on-device')).not.toBeVisible();
  });

  test('plain-English "of" glosses do not get a nested link', async ({ page }) => {
    await readerWord(page, 'pond').click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByText('pound (unit of weight)')).toBeVisible({ timeout: 5000 });

    await expect(drawer.getByTestId('nested-word-link')).toHaveCount(0);
  });
});
