import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { SETTINGS_KEYS } from '@/app/settings/constants';

// Reader typography (#570). Three layers decide how a lesson is drawn: the
// language pack, the reader's global setting, and the reader's per-language
// setting. These specs hold the layering, because a mistake in it is invisible
// in one language and wrong in the next — the fault the issue reports.
//
// German and Japanese, because they are the two ends of it. German takes the
// app defaults with no pack opinion. Japanese ships a tighter pack leading.

const DE_TEXT = 'Am Morgen gehe ich zum Bahnhof. Ich lese ein Buch im Zug.';
const JA_TEXT = '私は毎朝早く起きて、駅まで歩きます。';

/**
 * Undo everything a test changed in the shared dev DB and the shared browser
 * storage. The suite runs one worker over one database, and the specs that
 * follow read Afrikaans lessons through the stored target language — so a spec
 * that leaves the account in Japanese breaks them and not itself.
 */
async function restoreDefaults(page: Page) {
  while (seeded.length) {
    await page.request.delete(apiUrl(`/api/collections/${seeded.pop()}`));
  }
  await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  await page.goto('/');
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.setItem('lector-target-language', 'af');
  }, SETTINGS_KEYS.PROSE_STYLE);
}

/** Put the account in `code` on both the server and the client cache. */
async function useLanguage(page: Page, code: string) {
  await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: code } });
  await page.goto('/');
  await page.evaluate((c) => localStorage.setItem('lector-target-language', c), code);
}

/** Collections seeded by the test in flight, removed in afterEach. */
const seeded: string[] = [];

async function seedLesson(page: Page, code: string, text: string): Promise<string> {
  const collection = await page.request.post(apiUrl('/api/collections'), {
    data: { title: `Prose ${code}`, language: code },
  });
  expect(collection.status(), await collection.text()).toBe(200);
  const { id } = await collection.json();
  seeded.push(id);
  const lesson = await page.request.post(
    apiUrl(`/api/collections/${id}/lessons?language=${code}`),
    {
      data: { title: `Prose ${code}`, textContent: text },
    },
  );
  expect(lesson.status(), await lesson.text()).toBe(200);
  const lessons = await (
    await page.request.get(apiUrl(`/api/collections/${id}/lessons?language=${code}`))
  ).json();
  return lessons[0].id;
}

/** What the article actually resolved to, read off the live styles. */
async function readerStyle(page: Page) {
  await expect(page.locator('article')).toBeVisible();
  return page.locator('article').evaluate((el) => {
    const style = getComputedStyle(el);
    const word = el.querySelector('span[data-testid="reader-word"]');
    return {
      fontSize: style.fontSize,
      letterSpacing: style.letterSpacing,
      lineHeight: style.getPropertyValue('--reader-line-height').trim(),
      annotatedLineHeight: style.getPropertyValue('--reader-line-height-annotated').trim(),
      wordWeight: word ? getComputedStyle(word).fontWeight : null,
    };
  });
}

async function setStored(page: Page, value: object | null) {
  await page.goto('/');
  await page.evaluate(
    ([key, json]) => {
      if (json === null) localStorage.removeItem(key);
      else localStorage.setItem(key, json);
    },
    [SETTINGS_KEYS.PROSE_STYLE, value === null ? null : JSON.stringify(value)] as const,
  );
}

test.describe('Reader prose style', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test.afterEach(async ({ page }) => {
    await restoreDefaults(page);
  });

  test('draws a Latin lesson at the app defaults when nothing is set', async ({ page }) => {
    await useLanguage(page, 'de');
    const lesson = await seedLesson(page, 'de', DE_TEXT);
    await setStored(page, null);

    await page.goto(`/read/${lesson}`);
    expect(await readerStyle(page)).toMatchObject({
      fontSize: '20px',
      letterSpacing: 'normal',
      lineHeight: '1.9',
      // 1.9 + 0.8 — the in-flow annotation extra.
      annotatedLineHeight: '2.7',
      wordWeight: '700',
    });
  });

  test('takes the pack leading for Japanese with no setting of its own', async ({ page }) => {
    await useLanguage(page, 'ja');
    const lesson = await seedLesson(page, 'ja', JA_TEXT);
    await setStored(page, null);

    await page.goto(`/read/${lesson}`);
    expect(await readerStyle(page)).toMatchObject({
      lineHeight: '1.7',
      // Plain Japanese reads at the pack's 1.7. An annotated paragraph does not:
      // furigana sit out of flow, and the browser reserves no room for them, so
      // the floor holds those lines apart. See MIN_ANNOTATED_LEADING.
      annotatedLineHeight: '2.3',
    });
  });

  test('lets a global setting beat the pack and reach every language', async ({ page }) => {
    await useLanguage(page, 'ja');
    const ja = await seedLesson(page, 'ja', JA_TEXT);
    await setStored(page, {
      global: { fontSize: 26, fontWeight: 400, letterSpacing: 0.02, lineHeight: 2.2 },
      byLanguage: {},
    });

    await page.goto(`/read/${ja}`);
    expect(await readerStyle(page)).toMatchObject({
      fontSize: '26px',
      letterSpacing: '0.52px',
      lineHeight: '2.2',
      wordWeight: '400',
    });
  });

  test('lets a per-language setting beat the global one, and leaves the others alone', async ({
    page,
  }) => {
    await useLanguage(page, 'ja');
    const ja = await seedLesson(page, 'ja', JA_TEXT);
    await useLanguage(page, 'de');
    const de = await seedLesson(page, 'de', DE_TEXT);
    await setStored(page, {
      global: { fontSize: 26, lineHeight: 2.2 },
      byLanguage: { ja: { lineHeight: 1.4 } },
    });

    await useLanguage(page, 'ja');
    await page.goto(`/read/${ja}`);
    expect(await readerStyle(page)).toMatchObject({
      fontSize: '26px',
      lineHeight: '1.4',
      // 1.4 + 0.25 is far below what an out-of-flow furigana needs, so the
      // annotated paragraphs stop at MIN_ANNOTATED_LEADING.
      annotatedLineHeight: '2.3',
    });

    await useLanguage(page, 'de');
    await page.goto(`/read/${de}`);
    expect(await readerStyle(page)).toMatchObject({ fontSize: '26px', lineHeight: '2.2' });
  });
});

test.describe('Prose style settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await useLanguage(page, 'ja');
    await setStored(page, null);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('prose-settings').scrollIntoViewIfNeeded();
  });

  test.afterEach(async ({ page }) => {
    await restoreDefaults(page);
  });

  test('shows the app defaults under All languages, not the active pack default', async ({
    page,
  }) => {
    // Japanese is the active language and its pack asks for 1.7. The global
    // numbers apply to every language, so the pack must not seed them.
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('20px');
    await expect(page.getByTestId('prose-lineHeight-value')).toHaveText('1.90');
  });

  test('keeps a slider out of the reader until it is saved', async ({ page }) => {
    await page.getByTestId('prose-fontSize').fill('26');
    await page.getByTestId('prose-fontSize').dispatchEvent('change');
    // The sample follows at once. Nothing is stored, so the reader does not.
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('26px');
    expect(
      await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEYS.PROSE_STYLE),
    ).toBeNull();

    await page.getByTestId('prose-save').click();
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      SETTINGS_KEYS.PROSE_STYLE,
    );
    expect(JSON.parse(stored!)).toEqual({ global: { fontSize: 26 }, byLanguage: {} });
  });

  test('save is dead until something moves, and dead again once it is saved', async ({ page }) => {
    await expect(page.getByTestId('prose-save')).toBeDisabled();
    await page.getByTestId('prose-fontSize').fill('26');
    await page.getByTestId('prose-fontSize').dispatchEvent('change');
    await expect(page.getByTestId('prose-save')).toBeEnabled();
    await page.getByTestId('prose-save').click();
    await expect(page.getByTestId('prose-save')).toBeDisabled();
  });

  test('a reset throws away the unsaved sliders', async ({ page }) => {
    await page.getByTestId('prose-fontSize').fill('34');
    await page.getByTestId('prose-fontSize').dispatchEvent('change');
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('34px');

    await page.getByTestId('prose-reset').click();
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('20px');
    await expect(page.getByTestId('prose-save')).toBeDisabled();
  });

  test('keeps an unsaved edit while the reader looks at another language', async ({ page }) => {
    await page.getByTestId('prose-fontSize').fill('30');
    await page.getByTestId('prose-fontSize').dispatchEvent('change');

    await page.getByTestId('prose-scope-ja').click();
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('20px');

    await page.getByTestId('prose-scope-global').click();
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('30px');
    await expect(page.getByTestId('prose-save')).toBeEnabled();
  });

  test('a language inherits the global size and keeps its own pack leading', async ({ page }) => {
    await page.getByTestId('prose-fontSize').fill('26');
    await page.getByTestId('prose-fontSize').dispatchEvent('change');
    await page.getByTestId('prose-save').click();

    await page.getByTestId('prose-scope-ja').click();
    await expect(page.getByTestId('prose-fontSize-value')).toHaveText('26px');
    await expect(page.getByTestId('prose-lineHeight-value')).toHaveText('1.70');

    await page.getByTestId('prose-lineHeight').fill('1.4');
    await page.getByTestId('prose-lineHeight').dispatchEvent('change');
    await page.getByTestId('prose-save').click();
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      SETTINGS_KEYS.PROSE_STYLE,
    );
    expect(JSON.parse(stored!)).toEqual({
      global: { fontSize: 26 },
      byLanguage: { ja: { lineHeight: 1.4 } },
    });
  });

  test('a reset makes the language follow the global settings again', async ({ page }) => {
    await page.getByTestId('prose-scope-ja').click();
    await page.getByTestId('prose-lineHeight').fill('1.4');
    await page.getByTestId('prose-lineHeight').dispatchEvent('change');
    await page.getByTestId('prose-save').click();
    await expect(page.getByTestId('prose-lineHeight-value')).toHaveText('1.40');

    await page.getByTestId('prose-reset').click();
    await expect(page.getByTestId('prose-lineHeight-value')).toHaveText('1.70');
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      SETTINGS_KEYS.PROSE_STYLE,
    );
    expect(stored === null || JSON.parse(stored).byLanguage.ja === undefined).toBe(true);
  });
});
