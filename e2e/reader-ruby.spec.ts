import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

// Ruby pronunciation annotations in the reader (#289 4.4). Mandarin is the only
// pack that declares an annotation source, because Han characters hide the
// reading — which is the whole reason the layer exists.
//
// Requires dictionary-zh.db in the e2e data dir (copied from data/ by the
// webServer bootstrap; fetched via the dict.env pin in CI).

const COLLECTION = 'Ruby E2E';
const COPY_MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// 我 / 喜欢 / 读书 — three words, no punctuation between the first three.
const TEXT = '我喜欢读书。';

/** Switch to Mandarin.
 *
 *  The stored setting is written first, and directly. `getLesson` and the other
 *  reader fetches send no language of their own and let the server resolve it,
 *  so the SERVER setting is what decides whether the reader finds the lesson.
 *  The selector is then driven for real, so the client language cache — which
 *  the sidebar and the practice pages read — agrees with it. */
async function switchToMandarin(page: Page) {
  await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'zh' } });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'zh');
  // The selector shows the native name, not the English one.
  await expect(selector).toContainText('中文');
}

/** The word spans of the article, in document order. */
function words(page: Page) {
  return page.locator('article span.cursor-pointer');
}

async function openLesson(page: Page): Promise<string> {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: COLLECTION, language: 'zh' },
  });
  expect(colRes.status(), await colRes.text()).toBe(200);
  const { id: collectionId } = await colRes.json();
  const lessonRes = await page.request.post(
    apiUrl(`/api/collections/${collectionId}/lessons?language=zh`),
    { data: { title: '第一课', textContent: TEXT } },
  );
  expect(lessonRes.status(), await lessonRes.text()).toBe(200);
  const lessons = await (
    await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons?language=zh`))
  ).json();
  expect(lessons).toHaveLength(1);

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  // Three words plus the full stop. Not getByText: with an annotation a word
  // span's own text reads '我wǒ', so an exact text match no longer finds it.
  await expect(words(page)).toHaveCount(3, { timeout: 10000 });
  return collectionId;
}

/** Drag-select from one word to another.
 *
 *  Aims low in each box on purpose. A word's box grows upward to hold its ruby
 *  annotation, so the vertical middle can land on the annotation instead of the
 *  word, and a drag that starts there selects nothing. */
async function dragSelect(page: Page, fromIndex: number, toIndex: number) {
  const from = await words(page).nth(fromIndex).boundingBox();
  const to = await words(page).nth(toIndex).boundingBox();
  if (!from || !to) throw new Error('missing word bounding boxes');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8);
  await page.mouse.up();
}

test.describe('Reader ruby annotations (#289 4.4)', () => {
  let collectionId: string;

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mock translation so a dictionary miss needs no real LLM.
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

    const existing = await (await page.request.get(apiUrl('/api/collections'))).json();
    for (const collection of existing) {
      if (collection.title === COLLECTION) {
        await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
      }
    }

    await switchToMandarin(page);
    collectionId = await openLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('prints pinyin above every word', async ({ page }) => {
    const first = words(page).first();
    await expect(first.locator('ruby')).toHaveCount(1);
    await expect(first.locator('rt')).toHaveText('wǒ');

    // Every word is annotated, not just the first.
    await expect(page.locator('article rt')).toHaveCount(3);

    // The reading is an annotation, so it must not be selectable — that is what
    // keeps it out of a copied selection.
    const selectable = await first
      .locator('rt')
      .evaluate((el) => getComputedStyle(el).userSelect);
    expect(selectable).toBe('none');

    await page.screenshot({ path: 'tmp/reader-ruby.png' });
  });

  test('the toggle cycles off, learning, all, and survives a reload', async ({ page }) => {
    const toggle = page.getByTestId('annotation-mode-button');
    await expect(toggle).toBeVisible();
    // 'learning' is the default for a language that has readings.
    await expect(toggle).toHaveAttribute('aria-label', 'Pronunciation: Learning words');
    await expect(page.locator('article rt')).toHaveCount(3);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Pronunciation: All words');
    await expect(page.locator('article rt')).toHaveCount(3);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Pronunciation: Off');
    await expect(page.locator('article rt')).toHaveCount(0);

    // The preference is remembered, so a learner does not re-set it per lesson.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('annotation-mode-button')).toHaveAttribute(
      'aria-label',
      'Pronunciation: Off',
    );
    await expect(page.locator('article rt')).toHaveCount(0);
  });

  test('learning mode drops the reading of a word marked known', async ({ page }) => {
    await expect(words(page).first().locator('rt')).toHaveCount(1);

    await words(page).first().click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await drawer.getByTestId('mark-word-known').click();

    // The point of the default mode: the annotation retires with the word…
    await expect(words(page).first().locator('rt')).toHaveCount(0);
    // …while its neighbours keep theirs.
    await expect(page.locator('article rt')).toHaveCount(2);

    // 'all' mode brings it back.
    await page.getByTestId('annotation-mode-button').click();
    await expect(page.locator('article rt')).toHaveCount(3);
  });

  // Phrase selection in an unspaced script (#213). The guards used to test for a
  // space, and the phrase used to be split on whitespace, so no Chinese drag
  // ever produced a phrase and nothing ever highlighted.
  test('a dragged phrase highlights and copies without the annotations', async ({ page }) => {
    await dragSelect(page, 0, 2);

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // All three words carry the phrase highlight.
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(3);

    // The phrase the app read out of the DOM, built by walking the range and
    // skipping <rt>. `range.toString()` ignores `user-select: none`, so without
    // that walk this would read '我wǒ喜欢xǐhuan读书dúshū'.
    await expect(drawer.getByRole('heading', { name: '我喜欢读书' })).toBeVisible();

    // …and the clipboard agrees, which is the CSS guard rather than our walk.
    await page.keyboard.press(`${COPY_MOD}+c`);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('我喜欢读书');
  });

  // The sentence stored on a vocab row comes from reading the block out of the
  // DOM. An interleaved read would persist '我wǒ喜欢xǐhuan读书dúshū。', which the
  // Anki cloze builder later validates and rejects.
  test('a saved word stores a clean sentence', async ({ page }) => {
    await words(page).nth(1).click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await drawer.getByTestId('mark-word-known').click();

    await expect(async () => {
      const vocab = await (await page.request.get(apiUrl('/api/vocab?language=zh'))).json();
      const saved = (vocab.items ?? vocab).find(
        (entry: { text: string }) => entry.text === '喜欢',
      );
      expect(saved).toBeTruthy();
      expect(saved.sentence).toBe(TEXT);
    }).toPass({ timeout: 10000 });
  });
});
