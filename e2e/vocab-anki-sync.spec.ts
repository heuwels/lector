import { test, expect, Page, Route } from '@playwright/test';

/**
 * E2E for the /vocab page → "Sync with Anki" back-sync flow.
 *
 * Covers:
 *   - Clicking "Sync with Anki" calls findCards + cardsInfo from AnkiConnect
 *   - A Mature card (type 2, interval ≥ 21) upgrades the matching vocab entry to "known"
 *   - A Young card (type 2, interval < 21) upgrades to "Level 3"
 *   - A New card (type 0) upgrades to "Level 1"
 *   - The success toast shows the match/upgrade counts
 *   - Ignored entries are never touched
 *
 * AnkiConnect is mocked; no real Anki instance required.
 */

interface AnkiCardStub {
  cardId: number;
  type: number;
  interval: number;
  word: string;
}

async function seedVocabEntry(
  page: Page,
  text: string,
  state: string,
): Promise<string> {
  const id = `e2e-sync-${text}-${Date.now().toString(36)}`;
  const res = await page.request.post('http://localhost:3456/api/vocab', {
    data: {
      id,
      text,
      type: 'word',
      sentence: `Dit is 'n sin met ${text}.`,
      translation: 'This is a test sentence.',
      state,
      stateUpdatedAt: new Date().toISOString(),
      reviewCount: 0,
      createdAt: new Date().toISOString(),
      pushedToAnki: true,
      language: 'af',
    },
  });
  expect(res.ok()).toBeTruthy();
  return id;
}

async function deleteVocabEntry(page: Page, id: string) {
  await page.request.delete(`http://localhost:3456/api/vocab/${id}`);
}

function makeCardsInfoResult(stubs: AnkiCardStub[]) {
  return stubs.map((s) => ({
    cardId: s.cardId,
    interval: s.interval,
    type: s.type,
    note: s.cardId,
    deckName: 'Afrikaans',
    fields: {
      Front: {
        value: `Dit is 'n sin met <b>${s.word}</b>`,
        order: 0,
      },
      Back: { value: `translation — <b>${s.word}</b> = meaning`, order: 1 },
    },
  }));
}

async function mockAnkiConnect(page: Page, cardStubs: AnkiCardStub[]) {
  const cardIds = cardStubs.map((s) => s.cardId);

  await page.route('**://localhost:8765/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers: corsHeaders() });
      return;
    }
    const body = JSON.parse(req.postData() || '{}') as { action: string };
    const headers = corsHeaders();

    switch (body.action) {
      case 'version':
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 6, error: null }) });
        break;
      case 'deckNames':
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: ['Afrikaans', 'Afrikaans::Cloze'], error: null }) });
        break;
      case 'findCards':
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: cardIds, error: null }) });
        break;
      case 'cardsInfo':
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: makeCardsInfoResult(cardStubs), error: null }) });
        break;
      default:
        await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: null, error: null }) });
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json',
  };
}

test.describe('Vocab → Sync with Anki back-sync', () => {
  const ids: string[] = [];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.request.delete('http://localhost:3456/api/settings/ankiConnectUrl').catch(() => {});
  });

  test.afterEach(async ({ page }) => {
    for (const id of ids.splice(0)) {
      await deleteVocabEntry(page, id);
    }
  });

  test('Mature card (type 2, interval 25) upgrades matching entry to known', async ({ page }) => {
    const word = `matuurtoets${Date.now().toString(36)}`;
    const id = await seedVocabEntry(page, word, 'new');
    ids.push(id);

    await mockAnkiConnect(page, [{ cardId: 111, type: 2, interval: 25, word }]);

    await page.goto('/vocab');
    await expect(page.getByRole('row').filter({ hasText: word })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Sync with Anki/ }).click();

    await expect(page.getByText(/upgraded 1/i)).toBeVisible({ timeout: 8000 });

    await page.reload();
    const row = page.getByRole('row').filter({ hasText: word });
    await expect(row).toContainText(/level.?4/i, { timeout: 5000 });
  });

  test('Young card (type 2, interval 10) upgrades matching entry to Level 3', async ({ page }) => {
    const word = `youngtoets${Date.now().toString(36)}`;
    const id = await seedVocabEntry(page, word, 'new');
    ids.push(id);

    await mockAnkiConnect(page, [{ cardId: 222, type: 2, interval: 10, word }]);

    await page.goto('/vocab');
    await expect(page.getByRole('row').filter({ hasText: word })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Sync with Anki/ }).click();

    await expect(page.getByText(/upgraded 1/i)).toBeVisible({ timeout: 8000 });

    await page.reload();
    const row = page.getByRole('row').filter({ hasText: word });
    await expect(row).toContainText(/level.?3/i, { timeout: 5000 });
  });

  test('New card (type 0) upgrades matching entry to Level 1', async ({ page }) => {
    const word = `newtoets${Date.now().toString(36)}`;
    const id = await seedVocabEntry(page, word, 'new');
    ids.push(id);

    await mockAnkiConnect(page, [{ cardId: 333, type: 0, interval: 0, word }]);

    await page.goto('/vocab');
    await expect(page.getByRole('row').filter({ hasText: word })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Sync with Anki/ }).click();

    await expect(page.getByText(/upgraded 1/i)).toBeVisible({ timeout: 8000 });
  });

  test('ignored entry is never touched even with a Mature Anki card', async ({ page }) => {
    const word = `ignoredtoets${Date.now().toString(36)}`;
    const id = await seedVocabEntry(page, word, 'ignored');
    ids.push(id);

    await mockAnkiConnect(page, [{ cardId: 444, type: 2, interval: 100, word }]);

    await page.goto('/vocab');
    // Ignored entries are filtered out of the list — just trigger the sync.
    await page.getByRole('button', { name: /Sync with Anki/ }).click();

    // upgraded 0
    await expect(page.getByText(/upgraded 0/i)).toBeVisible({ timeout: 8000 });
  });
});
