import { test, expect, Page, BrowserContext } from '@playwright/test';
import { apiUrl } from './api';

/**
 * Touch phrase selection: long-press a word, drag across the phrase, release.
 *
 * A touch drag emits no `mouseup`, so the mouse path in
 * reader-phrase-selection.spec.ts cannot cover this. The gestures below go
 * through CDP because Playwright has no long-press primitive, and a synthesized
 * TouchEvent would not exercise the passive listeners or the click the browser
 * makes from a tap.
 */

const HOLD_MS = 500;

type Point = { x: number; y: number };

async function touch(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  const points = (at: Point | null) =>
    at ? [{ x: at.x, y: at.y, radiusX: 12, radiusY: 12, force: 1, id: 1 }] : [];
  return {
    start: (at: Point) =>
      cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(at) }),
    move: (at: Point) =>
      cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(at) }),
    end: () =>
      cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points(null) }),
  };
}

async function centreOf(page: Page, index: number): Promise<Point> {
  const box = await page.locator('article [data-testid="reader-word"]').nth(index).boundingBox();
  if (!box) throw new Error(`word ${index} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openLesson(page: Page): Promise<string> {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Touch Phrase Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  // Long enough to scroll on a phone viewport, so the scroll test has somewhere
  // to go. Word spans 0-4 are the first paragraph.
  const filler = Array.from({ length: 40 }, () => 'Die kat slaap onder die boom.').join('\n\n');
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: { title: 'Hoofstuk 1', textContent: `Die groot hond loop vinnig.\n\n${filler}` },
  });

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();
  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('vinnig')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

test.describe('Reader phrase selection on touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  let collectionId: string;

  test.beforeEach(async ({ page }) => {
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

    const res = await page.request.get(apiUrl('/api/collections'));
    for (const collection of await res.json()) {
      if (collection.title === 'Touch Phrase Test') {
        await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
      }
    }

    collectionId = await openLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('long-press and drag selects a phrase and opens the drawer', async ({ page, context }) => {
    const finger = await touch(context, page);
    const from = await centreOf(page, 0);
    const to = await centreOf(page, 2);

    await finger.start(from);
    await page.waitForTimeout(HOLD_MS);
    // The held word highlights before the drag, so the gesture is visible.
    await expect(page.locator('[data-phrase-dragging]')).toHaveCount(1);

    await finger.move(to);
    await expect(page.locator('[data-phrase-dragging]')).toHaveCount(3);
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading').first()).toHaveText('Die groot hond');

    // The drag markers give way to the committed highlight.
    await expect(page.locator('[data-phrase-dragging]')).toHaveCount(0);
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(3);
  });

  test('a backwards drag selects the same phrase', async ({ page, context }) => {
    const finger = await touch(context, page);
    await finger.start(await centreOf(page, 2));
    await page.waitForTimeout(HOLD_MS);
    await finger.move(await centreOf(page, 0));
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading').first()).toHaveText('Die groot hond');
  });

  test('a drag without a hold scrolls and selects nothing', async ({ page, context }) => {
    const finger = await touch(context, page);
    const from = await centreOf(page, 0);

    await finger.start(from);
    // No hold: each move is under the arming delay, so the page keeps the touch.
    for (let step = 1; step <= 6; step++) {
      await finger.move({ x: from.x, y: from.y - step * 40 });
      await page.waitForTimeout(16);
    }
    await finger.end();

    const scrolled = await page
      .locator('article')
      .evaluate((el) => (el.parentElement as HTMLElement).scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(0);
    await expect(page.locator('[data-phrase-dragging]')).toHaveCount(0);
  });

  test('a long-press on one word looks that word up, not a phrase', async ({ page, context }) => {
    const finger = await touch(context, page);
    await finger.start(await centreOf(page, 1));
    await page.waitForTimeout(HOLD_MS);
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading').first()).toHaveText('groot');
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(0);
    await expect(page.locator('[data-active-word]')).toHaveCount(1);
  });
});
