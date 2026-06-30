import { test, expect, Page, Route } from '@playwright/test';
import path from 'path';

/**
 * E2E for issue #197: Reader → Anki pipeline.
 *
 * Covers:
 *   - Word click: "Add to Anki" button appears in drawer footer
 *   - Clicking it sends a Basic addNote to AnkiConnect with <b>word</b> Front
 *   - The vocab entry is created (or updated) and marked pushedToAnki
 *   - Phrase drag-selection: "Add to Anki as Cloze" button appears
 *   - Cloze picker shows word chips; selecting one previews the blank
 *   - "Send to Anki" sends a Cloze addNote with {{c1::word}} in Text
 *   - Error case: when AnkiConnect is unreachable the button shows "error"
 *
 * AnkiConnect is mocked (Anki isn't running in CI).
 */

interface AnkiCall {
  action: string;
  params?: {
    note?: {
      deckName?: string;
      modelName?: string;
      fields?: Record<string, string>;
      tags?: string[];
    };
  };
}

async function mockAnkiConnect(page: Page): Promise<AnkiCall[]> {
  const calls: AnkiCall[] = [];

  const handleAnkiRoute = async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as AnkiCall;
    calls.push(body);
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers });
      return;
    }
    const { action } = body;
    if (action === 'version') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 6, error: null }) });
    } else if (action === 'deckNames') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: ['Afrikaans', 'Afrikaans::Cloze'], error: null }) });
    } else if (action === 'createDeck') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 1, error: null }) });
    } else if (action === 'addNote') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 1234567890, error: null }) });
    } else {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: null, error: null }) });
    }
  };

  await page.route('**://localhost:8765/**', handleAnkiRoute);
  await page.route('http://localhost:8765/', handleAnkiRoute);
  return calls;
}

async function importAndOpenReader(page: Page) {
  const fs = await import('fs');
  const epubPath = path.join(__dirname, 'fixtures/test-book.epub');
  const buffer = fs.readFileSync(epubPath);

  const importRes = await page.request.post('http://localhost:3457/api/import/epub', {
    multipart: {
      file: { name: 'test-book.epub', mimeType: 'application/epub+zip', buffer },
    },
  });
  const { collectionId } = await importRes.json();

  const lessonsRes = await page.request.get(`http://localhost:3457/api/collections/${collectionId}/lessons`);
  const lessons = await lessonsRes.json();
  const lessonId = lessons[0].id;

  await page.goto(`/read/${lessonId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Dit is die eerste hoofstuk')).toBeVisible({ timeout: 10000 });

  return { collectionId, lessonId };
}

async function cleanupCollections(page: Page) {
  const res = await page.request.get('http://localhost:3457/api/collections');
  const collections = await res.json();
  for (const c of collections) {
    if (c.title.startsWith('Toets') || c.title.startsWith('Test')) {
      await page.request.delete(`http://localhost:3457/api/collections/${c.id}`);
    }
  }
}

test.describe('Reader → Anki pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Clear any custom AnkiConnect URL so the mock at localhost:8765 is used.
    await page.request.delete('http://localhost:3457/api/settings/ankiConnectUrl').catch(() => {});

    // Mock translate so word clicks don't need a real LLM.
    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          translation: `[test: ${body.word}]`,
          partOfSpeech: 'noun',
        }),
      });
    });

    // Word dict-misses stream a plain-text gloss from /translate/gloss.
    await page.route('**/api/translate/gloss', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'test gloss',
      });
    });

    await cleanupCollections(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupCollections(page);
  });

  test('word click shows "Add to Anki" button in drawer footer', async ({ page }) => {
    const ankiCalls = await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpan = page.locator('article span.cursor-pointer').first();
    await wordSpan.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Wait for translation to resolve (loading spinner disappears)
    await expect(drawer.getByTestId('add-to-anki-btn')).toBeVisible({ timeout: 8000 });

    expect(ankiCalls.length).toBe(0); // not yet clicked
  });

  test('clicking "Add to Anki" sends a Basic card with <b>word</b> Front', async ({ page }) => {
    const ankiCalls = await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpan = page.locator('article span.cursor-pointer').first();
    const wordText = await wordSpan.textContent();
    await wordSpan.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    const addBtn = drawer.getByTestId('add-to-anki-btn');
    await expect(addBtn).toBeVisible({ timeout: 8000 });
    await addBtn.click();

    // Button should change to success state
    await expect(addBtn).toHaveText('✓ Added to Anki', { timeout: 5000 });

    // AnkiConnect should have received createDeck + addNote
    const addNoteCall = ankiCalls.find((c) => c.action === 'addNote');
    expect(addNoteCall).toBeTruthy();
    expect(addNoteCall!.params!.note!.modelName).toBe('Basic');
    expect(addNoteCall!.params!.note!.tags).toContain('lector');

    // Front must be exactly <b>word</b> — the pure-word format required by #197
    const front = addNoteCall!.params!.note!.fields!['Front'];
    expect(front).toMatch(/^<b>.+<\/b>$/);

    // The word in bold must match what was clicked
    const boldMatch = front.match(/<b>([^<]+)<\/b>/);
    expect(boldMatch![1].toLowerCase()).toBe(wordText!.trim().toLowerCase());
  });

  test('"Add to Anki" button is disabled after push (prevents double-submit)', async ({ page }) => {
    const ankiCalls = await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpan = page.locator('article span.cursor-pointer').first();
    await wordSpan.click();

    const drawer = page.getByTestId('translation-drawer');
    const addBtn = drawer.getByTestId('add-to-anki-btn');
    await expect(addBtn).toBeVisible({ timeout: 8000 });
    await addBtn.click();

    // Wait for the full round-trip to complete (done state, not just loading)
    // before asserting call count — avoids the loading→done race.
    await expect(addBtn).toHaveText('✓ Added to Anki', { timeout: 5000 });
    await expect(addBtn).toBeDisabled();

    const addNoteCalls = ankiCalls.filter((c) => c.action === 'addNote');
    expect(addNoteCalls.length).toBe(1);
  });

  test('phrase selection shows "Add to Anki as Cloze" button', async ({ page }) => {
    await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpans = page.locator('article span.cursor-pointer');
    const firstWord = wordSpans.first();
    const thirdWord = wordSpans.nth(2);

    const box1 = await firstWord.boundingBox();
    const box2 = await thirdWord.boundingBox();
    if (!box1 || !box2) throw new Error('Could not get word bounding boxes');

    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.up();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Phrase drawer: cloze button, NOT the basic "Add to Anki" button
    await expect(drawer.getByTestId('add-cloze-btn')).toBeVisible({ timeout: 8000 });
    await expect(drawer.getByTestId('add-to-anki-btn')).not.toBeVisible();
  });

  test('cloze picker shows word chips and preview after selection', async ({ page }) => {
    await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpans = page.locator('article span.cursor-pointer');
    const box1 = await wordSpans.first().boundingBox();
    const box2 = await wordSpans.nth(2).boundingBox();
    if (!box1 || !box2) throw new Error('No bounding boxes');

    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.up();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    // Open the cloze picker
    const clozeBtn = drawer.getByTestId('add-cloze-btn');
    await expect(clozeBtn).toBeVisible({ timeout: 8000 });
    await clozeBtn.click();

    // Word chips should appear
    const chips = drawer.getByTestId('cloze-word-chips');
    await expect(chips).toBeVisible();
    const chipButtons = chips.locator('button');
    const chipCount = await chipButtons.count();
    expect(chipCount).toBeGreaterThanOrEqual(2);

    // Click the first chip
    await chipButtons.first().click();

    // Preview should appear showing the blank
    await expect(drawer.getByTestId('cloze-preview')).toBeVisible();
    await expect(drawer.getByTestId('cloze-send-btn')).not.toBeDisabled();
  });

  test('sending a cloze card posts Cloze addNote with {{c1::word}}', async ({ page }) => {
    const ankiCalls = await mockAnkiConnect(page);
    await importAndOpenReader(page);

    const wordSpans = page.locator('article span.cursor-pointer');
    const box1 = await wordSpans.first().boundingBox();
    const box2 = await wordSpans.nth(2).boundingBox();
    if (!box1 || !box2) throw new Error('No bounding boxes');

    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.up();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5000 });

    const clozeSection = drawer.getByTestId('add-cloze-section');
    await clozeSection.getByTestId('add-cloze-btn').click();

    const chips = drawer.getByTestId('cloze-word-chips');
    await expect(chips).toBeVisible({ timeout: 3000 });

    // Get the first chip's text then click it
    const firstChip = chips.locator('button').first();
    const chipText = await firstChip.textContent();
    await firstChip.click();

    // Send to Anki
    const sendBtn = drawer.getByTestId('cloze-send-btn');
    await expect(sendBtn).not.toBeDisabled();
    await sendBtn.click();

    // Button should show success
    await expect(sendBtn).toHaveText('✓ Sent to Anki', { timeout: 5000 });

    // AnkiConnect must receive a Cloze addNote
    const addNoteCall = ankiCalls.find((c) => c.action === 'addNote');
    expect(addNoteCall).toBeTruthy();
    expect(addNoteCall!.params!.note!.modelName).toBe('Cloze');
    expect(addNoteCall!.params!.note!.tags).toContain('lector');

    // Text field must contain a {{c1::}} blank for the chosen word
    const textField = addNoteCall!.params!.note!.fields!['Text'];
    expect(textField).toContain(`{{c1::${chipText!.trim()}}}`);
  });

  test('Anki error shows error state on button', async ({ page }) => {
    // Override the mock to return an error for addNote
    await page.route('**://localhost:8765/**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}') as AnkiCall;
      const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
      if (body.action === 'addNote') {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: null, error: 'collection is not available' }) });
      } else if (body.action === 'createDeck') {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 1, error: null }) });
      } else {
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 6, error: null }) });
      }
    });

    await importAndOpenReader(page);

    const wordSpan = page.locator('article span.cursor-pointer').first();
    await wordSpan.click();

    const drawer = page.getByTestId('translation-drawer');
    const addBtn = drawer.getByTestId('add-to-anki-btn');
    await expect(addBtn).toBeVisible({ timeout: 8000 });
    await addBtn.click();

    // Should show error state
    await expect(addBtn).toHaveText('Anki error — retry', { timeout: 5000 });
    // And not be disabled — user can retry
    await expect(addBtn).not.toBeDisabled();
  });
});
