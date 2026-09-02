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

  // The first paragraph is long enough to wrap on a phone, so the wrap test has
  // a second line inside one block. The filler gives the scroll test somewhere
  // to go.
  const opening = 'Die groot hond loop baie vinnig deur die lang groen gras.';
  const filler = Array.from({ length: 40 }, () => 'Die kat slaap onder die boom.').join('\n\n');
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: { title: 'Hoofstuk 1', textContent: `${opening}\n\n${filler}` },
  });

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();
  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('vinnig')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

/** Index of the first word that the browser drew on a later line than word 0. */
async function firstWordOnNextLine(page: Page): Promise<number> {
  const words = page.locator('article [data-testid="reader-word"]');
  const first = await words.nth(0).boundingBox();
  if (!first) throw new Error('word 0 has no box');
  const total = await words.count();
  for (let index = 1; index < total; index++) {
    const box = await words.nth(index).boundingBox();
    if (box && box.y > first.y + first.height / 2) return index;
  }
  throw new Error('the opening paragraph did not wrap');
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

  test('the run follows a wrap onto the next line of the same block', async ({ page, context }) => {
    const wrapped = await firstWordOnNextLine(page);
    const finger = await touch(context, page);

    await finger.start(await centreOf(page, 0));
    await page.waitForTimeout(HOLD_MS);
    await finger.move(await centreOf(page, wrapped));
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    // Every word from the first line and the wrap target, and nothing after it.
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(wrapped + 1);
  });

  test('the phrase survives the click a tap makes', async ({ page, context }) => {
    const finger = await touch(context, page);
    await finger.start(await centreOf(page, 0));
    await page.waitForTimeout(HOLD_MS);
    await finger.move(await centreOf(page, 2));
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // A click on the word under the finger would clear the phrase and show one
    // word. Give any such click time to land, then prove nothing changed.
    await page.waitForTimeout(400);
    await expect(drawer.getByRole('heading').first()).toHaveText('Die groot hond');
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(3);
    await expect(page.locator('[data-active-word]')).toHaveCount(0);
  });
});

test.describe('Reader phrase selection on touch in a transcript', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  test.skip(
    !!process.env.E2E_EXTERNAL_SERVER,
    'transcript-import fixtures are not shipped in the production image',
  );

  const TITLE = 'Klein Rooikappie';

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translation: `[translated: ${body.word}]`, partOfSpeech: 'phrase' }),
      });
    });

    const res = await page.request.get(apiUrl('/api/collections'));
    for (const collection of await res.json()) {
      if (collection.title === TITLE) {
        await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
      }
    }

    const importRes = await page.request.post(apiUrl('/api/import/youtube'), {
      data: {
        url: 'https://www.youtube.com/watch?v=vid00000010',
        languageCode: 'af',
        kind: 'standard',
        language: 'af',
      },
    });
    const { lessonId } = await importRes.json();
    await page.goto(`/read/${lessonId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('transcript-reader')).toBeVisible({ timeout: 15000 });
  });

  test.afterEach(async ({ page }) => {
    const res = await page.request.get(apiUrl('/api/collections'));
    for (const collection of await res.json()) {
      if (collection.title === TITLE) {
        await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
      }
    }
  });

  test('a hold and a drag inside one cue selects that phrase', async ({ page, context }) => {
    // The third cue reads "Sy loop deur die woud".
    const cue = page.getByTestId('transcript-segment').nth(2);
    await cue.scrollIntoViewIfNeeded();
    const words = cue.locator('[data-testid="reader-word"]');

    const boxOf = async (index: number) => {
      const box = await words.nth(index).boundingBox();
      if (!box) throw new Error(`cue word ${index} has no box`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    const finger = await touch(context, page);
    await finger.start(await boxOf(0));
    await page.waitForTimeout(HOLD_MS);
    await finger.move(await boxOf(1));
    await finger.end();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading').first()).toHaveText('Sy loop');
    await expect(cue.locator('[data-phrase-highlighted]')).toHaveCount(2);
  });
});
