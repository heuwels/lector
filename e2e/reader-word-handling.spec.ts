import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/** Create a collection with a lesson containing hyphenated words via API */
async function importHyphenatedLesson(page: Page) {
  // Create collection
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Hyphen Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  // Add lesson with hyphenated words
  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: {
      title: 'Hoofstuk 1',
      textContent:
        'Die Perdekraal-fees is baie gewild. Ons gaan na die Klein-Karoo toe.',
    },
  });

  const lessonsRes = await page.request.get(
    apiUrl(`/api/collections/${collectionId}/lessons`)
  );
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Perdekraal-fees')).toBeVisible({
    timeout: 10000,
  });

  return collectionId;
}

test.describe('Reader word handling', () => {
  let collectionId: string;
  let knownWordsFetches: number;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    knownWordsFetches = 0;

    await page.route('**/api/known-words*', async (route) => {
      if (route.request().method() === 'GET') knownWordsFetches += 1;
      await route.continue();
    });

    // Mock translate API (phrase + legacy structured word path).
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

    // Word dict-misses now stream a plain-text gloss from /translate/gloss.
    await page.route('**/api/translate/gloss', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'text/plain', body: `[translated: ${body.word}]` });
    });

    // Clean up any leftover test collections
    const res = await page.request.get(apiUrl('/api/collections'));
    const collections = await res.json();
    for (const c of collections) {
      if (c.title === 'Hyphen Test') {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }

    // Delete any stale vocab entries for test words (server-side SQLite)
    const vocabRes = await page.request.get(apiUrl('/api/vocab?text=perdekraal-fees'));
    const vocabEntries = await vocabRes.json();
    for (const v of vocabEntries) {
      await page.request.delete(apiUrl(`/api/vocab/${v.id}`));
    }

    collectionId = await importHyphenatedLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });

  test('clicking a hyphenated word should translate the full token', async ({
    page,
  }) => {
    // "Perdekraal-fees" should be a single clickable span
    const hyphenatedWord = page.locator('article span.cursor-pointer', {
      hasText: 'Perdekraal-fees',
    });
    await expect(hyphenatedWord).toBeVisible();

    await hyphenatedWord.click();

    // Word panel should open with the full hyphenated word
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    await expect(drawer.getByRole('heading', { name: 'Perdekraal-fees' })).toBeVisible();
  });

  test('keyboard lookup opens the same word drawer as clicking', async ({ page }) => {
    const word = page.getByRole('button', { name: 'Look up Perdekraal-fees' });
    await word.focus();
    await page.keyboard.press('Enter');

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await expect(drawer.getByRole('heading', { name: 'Perdekraal-fees' })).toBeVisible();
  });

  test('updates one word optimistically without refetching the known-words map', async ({ page }) => {
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    await page.route('**/api/vocab', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writeStarted();
      await writeGate;
      await route.continue();
    });

    const word = page.getByRole('button', { name: 'Look up Perdekraal-fees' });
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer.getByText('[translated:')).toBeVisible();
    await drawer.getByTestId('mark-word-known').click();
    await started;

    await expect(drawer.getByTestId('mark-word-known')).toHaveClass(/ring-2/);
    await expect(word).not.toHaveClass(/w-new-bg/);

    releaseWrite();
    await expect(drawer).toHaveClass(/translate-x-full/);
    await expect.poll(() => knownWordsFetches).toBe(1);
  });

  test('rolls back only the optimistic word when persistence fails', async ({ page }) => {
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    await page.route('**/api/vocab', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writeStarted();
      await writeGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });

    const word = page.getByRole('button', { name: 'Look up Perdekraal-fees' });
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer.getByText('[translated:')).toBeVisible();
    await drawer.getByTestId('mark-word-known').click();
    await started;

    await expect(drawer.getByTestId('mark-word-known')).toHaveClass(/ring-2/);
    await expect(word).not.toHaveClass(/w-new-bg/);

    releaseWrite();
    await expect(page.getByText('Could not mark the word as known')).toBeVisible();
    await expect(word).toHaveClass(/w-new-bg/);
    await expect(drawer.getByTestId('mark-word-known')).not.toHaveClass(/ring-2/);
    await expect.poll(() => knownWordsFetches).toBe(1);
  });

  test('Cmd+number should not trigger word level change', async ({ page }) => {
    // Click a word to open the word panel
    const word = page.locator('article span.cursor-pointer', {
      hasText: 'Perdekraal-fees',
    });
    await word.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    await expect(drawer.getByRole('heading', { name: 'Perdekraal-fees' })).toBeVisible();
    await expect(drawer.getByText('[translated:')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true })
      );
    });
    await page.waitForTimeout(300);

    // Level buttons render as their digit ("1", "2", "3", "4"). title="Level 1"
    // is non-accessible, so the role-name lookup needs the visible text.
    const levelButton = drawer.locator('button[title="Level 1"]');
    const classes = await levelButton.getAttribute('class');
    expect(classes).not.toContain('ring-2');

    await page.keyboard.press('1');
    await expect(levelButton).toHaveClass(/ring-2/, { timeout: 3000 });
  });
});
