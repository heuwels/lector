import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import path from 'path';

async function importAndOpenReader(page: Page) {
  const fs = await import('fs');
  const epubPath = path.join(__dirname, 'fixtures/test-book.epub');
  const buffer = fs.readFileSync(epubPath);

  const importRes = await page.request.post(apiUrl('/api/import/epub'), {
    multipart: {
      file: {
        name: 'test-book.epub',
        mimeType: 'application/epub+zip',
        buffer,
      },
    },
  });
  const { collectionId } = await importRes.json();

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');

  // Wait for reader content to load
  await expect(page.getByText('Dit is die eerste hoofstuk')).toBeVisible({ timeout: 10000 });
}

test.describe('Reader phrase selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Mock translate API to avoid needing real LLM
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

    // Clean up test collections
    const res = await page.request.get(apiUrl('/api/collections'));
    const collections = await res.json();
    for (const c of collections) {
      if (c.title.startsWith('Toets') || c.title.startsWith('Test')) {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }

    await importAndOpenReader(page);
  });

  test('partial word selection should snap to full word boundaries', async ({ page }) => {
    // Find a word span in the reader
    const wordSpans = page.locator('article span.cursor-pointer');
    await expect(wordSpans.first()).toBeVisible();

    // Get the bounding box of a word to select from its middle
    const firstWord = wordSpans.first();
    const box = await firstWord.boundingBox();
    if (!box) throw new Error('Could not get word bounding box');

    // Find a second word nearby
    const secondWord = wordSpans.nth(2);
    const box2 = await secondWord.boundingBox();
    if (!box2) throw new Error('Could not get second word bounding box');

    // Drag from middle of first word to middle of third word
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.up();

    // The drawer should open with a phrase
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Get the text shown in the drawer heading — it should contain complete words
    const panelText = await drawer.getByRole('heading').first().textContent();
    expect(panelText).toBeTruthy();

    // Verify no partial words: each word in the phrase should not start/end mid-word
    // A partial word would contain characters that don't match the word pattern
    const words = panelText!.trim().split(/\s+/);
    for (const word of words) {
      // Each word should be a complete token (letters, apostrophes, diacritics only)
      expect(word).toMatch(/^['''ʼ`]?n$|^[\wêëéèôöûüîïáà]+$/i);
    }
  });

  test('phrase highlight should remain visible after selection', async ({ page }) => {
    const wordSpans = page.locator('article span.cursor-pointer');
    await expect(wordSpans.first()).toBeVisible();

    const firstWord = wordSpans.first();
    const box = await firstWord.boundingBox();
    if (!box) throw new Error('Could not get word bounding box');

    const thirdWord = wordSpans.nth(2);
    const box2 = await thirdWord.boundingBox();
    if (!box2) throw new Error('Could not get second word bounding box');

    // Select a phrase by dragging
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.up();

    // The drawer should open with a phrase translation
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // The selected phrase spans should have the data-phrase-highlighted attribute
    const highlighted = page.locator('[data-phrase-highlighted]');
    const count = await highlighted.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
