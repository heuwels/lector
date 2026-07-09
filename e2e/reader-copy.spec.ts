import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Cmd/Ctrl differs by platform; the app accepts either (metaKey || ctrlKey).
const COPY_MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * A lesson with TWO paragraphs, each with "hond" at the same in-block word
 * index, so we prove the click highlight lands on the exact instance clicked
 * across block boundaries — not every occurrence of the spelling, and not the
 * same index in a sibling paragraph. Word span order:
 *   para 1: Die(0) hond(1) loop(2)
 *   para 2: Die(3) hond(4) hardloop(5) weg(6)
 */
async function openRepeatedWordLesson(page: Page): Promise<string> {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Copy Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: {
      title: 'Hoofstuk 1',
      textContent: 'Die hond loop.\n\nDie hond hardloop weg.',
    },
  });

  const lessonsRes = await page.request.get(
    apiUrl(`/api/collections/${collectionId}/lessons`)
  );
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('hardloop')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

test.describe('Reader word/phrase copy + active highlight', () => {
  let collectionId: string;

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mock translation so no real LLM is needed.
    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          translation: `[translated: ${body.word}]`,
          partOfSpeech: body.type === 'phrase' ? 'phrase' : 'noun',
        }),
      });
    });
    await page.route('**/api/translate/gloss', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'text/plain', body: `[translated: ${body.word}]` });
    });

    const res = await page.request.get(apiUrl('/api/collections'));
    for (const c of await res.json()) {
      if (c.title === 'Copy Test') {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }

    collectionId = await openRepeatedWordLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });

  test('clicking a word highlights that exact instance (not duplicates)', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    // Click the FIRST "hond" (span index 1, paragraph 1) — visible left of the
    // drawer.
    await wordSpans.nth(1).click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Exactly one active-word marker, and it is the one we clicked — NOT the
    // "hond" in paragraph 2 (index 4), which sits at the same in-block word
    // index. Proves the highlight is keyed to the exact instance (block + word
    // index), not the spelling or the index alone.
    const active = page.locator('[data-active-word]');
    await expect(active).toHaveCount(1);
    await expect(wordSpans.nth(1)).toHaveAttribute('data-active-word');
    await expect(wordSpans.nth(4)).not.toHaveAttribute('data-active-word');

    // The active word carries the clay highlight background (not transparent).
    const bg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');

    await page.screenshot({ path: 'tmp/reader-active-word.png' });
  });

  test('Cmd/Ctrl+C copies the clicked word', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    await wordSpans.nth(5).click(); // "hardloop" (paragraph 2)

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    await page.keyboard.press(`${COPY_MOD}+c`);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('hardloop');
  });

  test('Escape closes the drawer and clears the clicked-word highlight', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    await wordSpans.nth(1).click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(page.locator('[data-active-word]')).toHaveCount(1);

    await page.keyboard.press('Escape');

    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('[data-active-word]')).toHaveCount(0);
  });

  test('Escape clears a selected-phrase highlight', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    const first = await wordSpans.nth(0).boundingBox();
    const third = await wordSpans.nth(2).boundingBox();
    if (!first || !third) throw new Error('missing word bounding boxes');

    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await page.mouse.up();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    expect(await page.locator('[data-phrase-highlighted]').count()).toBeGreaterThanOrEqual(2);

    await page.keyboard.press('Escape');

    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 5000 });
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(0);
  });

  test('Cmd/Ctrl+C copies a selected phrase WITH spaces', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    const first = await wordSpans.nth(0).boundingBox(); // "Die"
    const third = await wordSpans.nth(2).boundingBox(); // "loop"
    if (!first || !third) throw new Error('missing word bounding boxes');

    // Drag from the middle of "Die" to the middle of "loop".
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await page.mouse.up();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    await page.keyboard.press(`${COPY_MOD}+c`);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(' ');
    expect(clip).toBe('Die hond loop');
  });
});
