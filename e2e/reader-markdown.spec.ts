import { test, expect, Page } from '@playwright/test';

const TITLE = 'Markdown Render Test';

// A lesson exercising headings, inline bold/italic, single-newline line breaks,
// and blank-line paragraph breaks.
const CONTENT = `## Hoofstuk Een

Die son **sak stadig** agter die berge.
Fiela staan en kyk na die *vlakte*.

Sy weet more gaan moeilik wees.`;

async function seedLesson(page: Page): Promise<string> {
  const colRes = await page.request.post('/api/collections', {
    data: { title: TITLE, language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(`/api/collections/${collectionId}/lessons`, {
    data: { title: 'Hoofstuk 1', textContent: CONTENT },
  });

  const lessonsRes = await page.request.get(`/api/collections/${collectionId}/lessons`);
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Hoofstuk Een')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

test.describe('Reader markdown rendering', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translation: `[translated: ${body.word}]`, partOfSpeech: 'noun' }),
      });
    });

    // Word dict-misses stream a plain-text gloss from /translate/gloss.
    await page.route('**/api/translate/gloss', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'text/plain', body: `[translated: ${body.word}]` });
    });

    const res = await page.request.get('/api/collections');
    for (const c of await res.json()) {
      if (c.title === TITLE) await page.request.delete(`/api/collections/${c.id}`);
    }

    collectionId = await seedLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(`/api/collections/${collectionId}`);
  });

  test('renders "##" as a real, larger heading (not body text)', async ({ page }) => {
    const h2 = page.locator('article h2');
    await expect(h2).toBeVisible();
    await expect(h2).toContainText('Hoofstuk Een');

    const h2Size = await h2.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const pSize = await page
      .locator('article p')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h2Size).toBeGreaterThan(pSize);
  });

  test('bold words stay bold AND remain highlighted/clickable', async ({ page }) => {
    // The word lives inside <strong> and is still a clickable word span.
    const boldWord = page.locator('article strong span.cursor-pointer', { hasText: 'sak' });
    await expect(boldWord).toBeVisible();

    await boldWord.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading', { name: 'sak' })).toBeVisible();
  });

  test('italic words remain highlighted/clickable', async ({ page }) => {
    const italicWord = page.locator('article em span.cursor-pointer', { hasText: 'vlakte' });
    await expect(italicWord).toBeVisible();
  });

  test('headings are styled but not word-wrapped (click-to-translate stays in the body)', async ({ page }) => {
    // Headings render as plain styled text — no clickable word chips — so the
    // reader's word spans live only in the body (p/li), as other specs assume.
    expect(await page.locator('article h2 span.cursor-pointer').count()).toBe(0);
    await expect(page.locator('article p span.cursor-pointer').first()).toBeVisible();
  });

  test('line breaks: single newline -> <br>, blank line -> separate paragraphs', async ({ page }) => {
    expect(await page.locator('article br').count()).toBeGreaterThan(0);
    expect(await page.locator('article p').count()).toBe(2);
  });
});
