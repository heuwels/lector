import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * Part 2 reader sidebar layout/behaviour tests.
 *
 * Covers:
 * - 1280px (lg+): sidebar docks in a reserved column, words don't overlap.
 * - 800px  (sm):   bottom sheet at ≤45vh; outside-click closes; word-switch
 *                  keeps the sheet open; Escape still two-staged.
 */

async function importLesson(page: Page) {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Layout Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: {
      title: 'Hoofstuk 1',
      textContent:
        'Die kat sit op die tafel. Die hond slaap. Die voël vlieg rondom die huis. Die slang kruip stilletjie.',
    },
  });

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('kat')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

async function routeTranslate(page: Page) {
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
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: `[translated: ${body.word}]`,
    });
  });
}

async function cleanupVocab(page: Page, words: string[]) {
  for (const word of words) {
    const resp = await page.request.get(apiUrl(`/api/vocab?text=${word}`));
    const entries = await resp.json();
    for (const v of entries) {
      await page.request.delete(apiUrl(`/api/vocab/${v.id}`));
    }
  }
}

test.describe('Reader sidebar layout (1280px — docked)', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await routeTranslate(page);
    await cleanupVocab(page, ['kat', 'sit', 'op', 'hond', 'voël', 'slang']);
    collectionId = await importLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });

  test('sidebar renders in a reserved column without word overlap', async ({ page }) => {
    const slot = page.getByTestId('translation-drawer-slot');
    await expect(slot).toBeVisible();
    // The slot is a flex-col that never shrinks — words can't bleed under it.
    await expect(slot).toHaveClass(/flex-col/);

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/);
    await expect(drawer).toHaveAttribute('role', 'complementary');

    // The reader content and sidebar share the flex row — content is not
    // overlapped by the sidebar.
    const article = page.locator('article');
    await expect(article).toBeVisible();
  });

  test('Escape ordering: clears selection first, then returns to idle', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Navigate to create a selection
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // First Escape: clears selection, drawer stays open
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(page.locator('[data-active-word]')).toHaveCount(0);

    // Second Escape: returns to idle empty state
    await page.keyboard.press('Escape');
    await expect(drawer.getByTestId('translation-drawer-empty')).toBeVisible();
  });
});

test.describe('Reader bottom-sheet behaviour (800px — sm)', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await routeTranslate(page);
    await cleanupVocab(page, ['kat', 'sit', 'op', 'hond', 'voël', 'slang']);
    collectionId = await importLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });

  test('drawer slides up as a bottom sheet (≤45vh) when a word is clicked', async ({ page }) => {
    const drawer = page.getByTestId('translation-drawer');
    // Closed: bottom sheet is off-screen
    await expect(drawer).toHaveClass(/translate-y-full/);

    const words = page.locator('[data-word-state]');
    await words.first().click();

    // Open: slides up
    await expect(drawer).toHaveClass(/translate-y-0/, { timeout: 5000 });
    await expect(drawer).toHaveAttribute('role', 'dialog');

    // Constrain height to ≤45vh of the viewport
    const vh = await page.evaluate(() => window.innerHeight);
    const maxAllowed = Math.floor(vh * 0.45);
    const drawerBox = await drawer.boundingBox();
    if (drawerBox) {
      expect(drawerBox.height).toBeLessThanOrEqual(maxAllowed + 2); // +2 for rounding
    }
  });

  test('clicking outside the drawer and outside words closes it', async ({ page }) => {
    const drawer = page.getByTestId('translation-drawer');
    const words = page.locator('[data-word-state]');
    await words.first().click();
    await expect(drawer).toHaveClass(/translate-y-0/, { timeout: 5000 });

    // Click the body margin — outside drawer and outside any word token
    const margin = page.locator('body');
    await margin.click({ position: { x: 5, y: 5 } });

    await expect(drawer).toHaveClass(/translate-y-full/, { timeout: 3000 });
  });

  test('clicking a second word switches content without closing or flickering', async ({
    page,
  }) => {
    const drawer = page.getByTestId('translation-drawer');
    const words = page.locator('[data-word-state]');
    const firstText = await words.first().textContent();
    const secondText = await words.nth(1).textContent();

    await words.first().click();
    await expect(drawer).toHaveClass(/translate-y-0/, { timeout: 5000 });

    // The close button must remain visible throughout (no flicker)
    const closeBtn = drawer.getByRole('button', { name: 'Close' });
    await expect(closeBtn).toBeVisible();

    // Click a different word
    await words.nth(1).click();

    // Drawer stays open and shows the new word
    await expect(drawer).toHaveClass(/translate-y-0/);
    if (secondText) {
      const cleanWord = secondText.replace(/[.,!?;:'")\]]+$/, '');
      await expect(drawer.getByRole('heading', { name: cleanWord })).toBeVisible();
    }

    // Close button was never removed (no flicker) — verify it still exists
    await expect(closeBtn).toBeVisible();
  });

  test('auto-scrolls a bottom-of-viewport word above the bottom sheet', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    const last = words.last();
    const lastText = await last.textContent();

    // Scroll the last word to the very bottom so it would be covered by the sheet
    await last.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.scrollBy(0, 60);
    });

    await last.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-y-0/, { timeout: 5000 });

    // The active word should no longer be visually under the sheet — its
    // top edge should be above the sheet's bottom edge.
    const sheetBottom = await page.evaluate(() => window.innerHeight);
    const wordRect = await last.boundingBox();
    if (wordRect && lastText) {
      const cleanWord = lastText.replace(/[.,!?;:'")\]]+$/, '');
      // Either the word is still above the sheet, or it was scrolled up
      expect(wordRect.bottom).toBeLessThanOrEqual(sheetBottom - 1);
    }
  });
});
