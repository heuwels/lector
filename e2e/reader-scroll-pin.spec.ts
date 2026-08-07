import { test, expect, Page, devices } from '@playwright/test';
import { apiUrl } from './api';

/**
 * The reader holds its reading position across a word lookup.
 *
 * On a phone the translation drawer covers the whole reader, so nothing the
 * learner does can move the text underneath it — but mobile Chrome moved it
 * anyway and dropped them back at the top of the article. MarkdownReader now
 * pins the offset the reader had when the word was tapped and re-asserts it
 * until the learner scrolls the reader themselves.
 *
 * The jump itself is a mobile-browser behaviour that headless Chromium does
 * not show, so these specs drive it directly: they scroll the container from
 * script while the drawer is up, which is exactly the shape of the bug (an
 * offset change with no learner gesture on the reader).
 */

test.use({ ...devices['Pixel 5'] });

const SENTENCES = [
  'Die perd hardloop vinnig oor die groen veld en die son skyn helder bo die berge.',
  'Ons kyk na die wolke en die water in die rivier loop stadig na die see toe.',
  'Die kinders speel in die tuin terwyl die honde blaf en die katte slaap.',
];

function longArticle(blocks: number) {
  const out: string[] = [];
  for (let i = 0; i < blocks; i++) {
    if (i % 5 === 0) out.push(`## Hoofstuk ${i}`);
    out.push(`Paragraaf ${i}. ${SENTENCES[i % 3]} ${SENTENCES[(i + 1) % 3]}`);
  }
  return out.join('\n\n');
}

async function importArticle(page: Page) {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Scroll Pin', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: { title: 'Lang Hoofstuk', textContent: longArticle(120) },
  });
  const lessons = await (
    await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
  ).json();
  return { collectionId, lessonId: lessons[0].id as string };
}

/** The reader's own scroll container — the article's parent. */
function scrollerOf(page: Page) {
  return page.locator('article').locator('..');
}

test.describe('reader scroll pin', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.get(apiUrl('/api/collections'));
    for (const c of await res.json()) {
      if (c.title === 'Scroll Pin') await page.request.delete(apiUrl(`/api/collections/${c.id}`));
    }
  });

  // The saving test mines a real vocab row. Left behind it shifts what the
  // practice queue serves, which other specs assert against — clean it out.
  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    const stale = await (await page.request.get(apiUrl('/api/vocab?text=perd'))).json();
    for (const entry of stale) await page.request.delete(apiUrl(`/api/vocab/${entry.id}`));
  });

  async function openDrawerOnWordDeepInArticle(page: Page) {
    const imported = await importArticle(page);
    collectionId = imported.collectionId;

    await page.goto(`/read/${imported.lessonId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Paragraaf 0.')).toBeVisible({ timeout: 15000 });

    const word = page
      .getByTestId('reader-word')
      .filter({ hasText: /^perd$/ })
      .nth(40);
    await word.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const scroller = scrollerOf(page);
    const readingPosition = await scroller.evaluate((el) => el.scrollTop);
    expect(readingPosition).toBeGreaterThan(1000);

    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 15000 });
    await expect(drawer.getByTestId('word-level-1')).toBeVisible({ timeout: 15000 });

    return { drawer, scroller, readingPosition };
  }

  test('puts the reading position back when the browser moves it under the drawer', async ({
    page,
  }) => {
    const { scroller, readingPosition } = await openDrawerOnWordDeepInArticle(page);

    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);

    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  });

  test('holds the position through saving a word and closing the drawer', async ({ page }) => {
    const { drawer, scroller, readingPosition } = await openDrawerOnWordDeepInArticle(page);

    await drawer.getByTestId('word-level-1').click();
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition);

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 15000 });
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  });

  test('never persists a rejected position as the reading progress', async ({ page }) => {
    const { scroller, readingPosition } = await openDrawerOnWordDeepInArticle(page);

    const writes: number[] = [];
    await page.route('**/api/lessons/*/progress', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (typeof body.scrollPosition === 'number') writes.push(body.scrollPosition);
      await route.continue();
    });

    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(1500);

    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition);
    expect(writes).not.toContain(0);
  });

  test('expires the pin so it never becomes a permanent scroll lock', async ({ page }) => {
    const { drawer, scroller, readingPosition } = await openDrawerOnWordDeepInArticle(page);

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 15000 });
    await page.waitForTimeout(2500); // past the pin's tail

    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
    expect(readingPosition).toBeGreaterThan(0);
  });

  test('releases the pin as soon as the learner scrolls the reader', async ({ page }) => {
    const { drawer, scroller, readingPosition } = await openDrawerOnWordDeepInArticle(page);

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveClass(/translate-x-full/, { timeout: 15000 });

    // A real gesture on the reader — the learner scrolling on with a swipe.
    await scroller.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      el.scrollTop = el.scrollTop + 900;
    });
    await page.waitForTimeout(400);

    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(readingPosition + 900);
  });
});
