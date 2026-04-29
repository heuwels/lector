import { test, expect, Page } from '@playwright/test';

/** Create a collection with a lesson containing hyphenated words via API */
async function importHyphenatedLesson(page: Page) {
  // Create collection
  const colRes = await page.request.post('/api/collections', {
    data: { title: 'Hyphen Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  // Add lesson with hyphenated words
  await page.request.post(`/api/collections/${collectionId}/lessons`, {
    data: {
      title: 'Hoofstuk 1',
      textContent:
        'Die Perdekraal-fees is baie gewild. Ons gaan na die Klein-Karoo toe.',
    },
  });

  const lessonsRes = await page.request.get(
    `/api/collections/${collectionId}/lessons`
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

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mock translate API
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

    // Clean up any leftover test collections
    const res = await page.request.get('/api/collections');
    const collections = await res.json();
    for (const c of collections) {
      if (c.title === 'Hyphen Test') {
        await page.request.delete(`/api/collections/${c.id}`);
      }
    }

    // Delete any stale vocab entries for test words (server-side SQLite)
    const vocabRes = await page.request.get('/api/vocab?text=perdekraal-fees');
    const vocabEntries = await vocabRes.json();
    for (const v of vocabEntries) {
      await page.request.delete(`/api/vocab/${v.id}`);
    }

    collectionId = await importHyphenatedLesson(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(`/api/collections/${collectionId}`);
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
    const wordPanel = page.locator('.fixed.bottom-0');
    await expect(wordPanel).toBeVisible({ timeout: 5000 });

    const panelWord = wordPanel.locator('span.font-bold').first();
    await expect(panelWord).toHaveText('Perdekraal-fees');
  });

  test('Cmd+number should not trigger word level change', async ({ page }) => {
    // Click a word to open the word panel
    const word = page.locator('article span.cursor-pointer', {
      hasText: 'Perdekraal-fees',
    });
    await word.click();

    const wordPanel = page.locator('.fixed.bottom-0');
    await expect(wordPanel).toBeVisible({ timeout: 5000 });

    // Wait for translation to load so level buttons are active
    await expect(
      wordPanel.locator('span.font-bold').first()
    ).toHaveText('Perdekraal-fees');
    await expect(wordPanel.getByText('[translated:')).toBeVisible();

    // Dispatch a keydown with metaKey=true via JS (Playwright keyboard API
    // doesn't reliably set metaKey in headless Chromium)
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true })
      );
    });
    await page.waitForTimeout(300);

    // Level should NOT be set — Cmd+1 should pass through
    const levelButton = wordPanel.locator('button', { hasText: '1' });
    const classes = await levelButton.getAttribute('class');
    expect(classes).not.toContain('ring-2');

    // Press bare 1 — this SHOULD set the level
    await page.keyboard.press('1');

    // Now level1 button should be active
    await expect(levelButton).toHaveClass(/ring-2/, { timeout: 3000 });
  });
});
