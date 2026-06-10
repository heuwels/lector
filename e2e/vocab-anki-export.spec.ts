import { test, expect, Page, Route } from '@playwright/test';

/**
 * E2E for the /vocab page → Anki bulk-export flow.
 *
 * Covers:
 *   - The Export-to-Anki modal opens with a selected-count summary
 *   - Basic and Cloze tile-style options render and toggle
 *   - Confirming with Basic calls AnkiConnect with the Basic model + Basic deck
 *   - Confirming with Cloze calls AnkiConnect with the Cloze model + Cloze deck
 *   - The user's card-type choice persists across page reloads (localStorage)
 *   - Already-synced entries are skipped (notification + no extra AnkiConnect call)
 *
 * AnkiConnect is mocked (Anki isn't running in CI). The mock inspects the
 * action name in the request body and returns a deterministic noteId.
 */

interface AnkiCall {
  action: string;
  params?: { note?: { deckName?: string; modelName?: string; fields?: Record<string, string> } };
}

async function seedVocabEntry(page: Page, text: string, sentence: string, translation: string) {
  // Use a deterministic id so we can target the row and clean up reliably.
  const id = `e2e-vocab-${text}-${Date.now().toString(36)}`;
  const res = await page.request.post('http://localhost:3456/api/vocab', {
    data: {
      id,
      text,
      type: 'word',
      sentence,
      translation,
      state: 'level1',
      stateUpdatedAt: new Date().toISOString(),
      reviewCount: 0,
      createdAt: new Date().toISOString(),
      pushedToAnki: false,
      language: 'af',
    },
  });
  expect(res.ok()).toBeTruthy();
  return id;
}

async function deleteVocabEntry(page: Page, id: string) {
  await page.request.delete(`http://localhost:3456/api/vocab/${id}`);
}

/**
 * Install an AnkiConnect mock. Returns the calls array so the test can assert
 * on what was sent. Each entry mirrors the JSON body the browser POSTed.
 */
async function mockAnkiConnect(page: Page): Promise<AnkiCall[]> {
  const calls: AnkiCall[] = [];
  // Browser fetches AnkiConnect at http://localhost:8765 (the default URL when
  // no ankiConnectUrl setting is configured). Match by host:port.
  await page.route('**://localhost:8765/**', async (route: Route) => {
    return handleAnkiRoute(route);
  });
  await page.route('http://localhost:8765/', async (route: Route) => {
    return handleAnkiRoute(route);
  });

  async function handleAnkiRoute(route: Route) {
    const body = JSON.parse(route.request().postData() || '{}') as AnkiCall;
    calls.push(body);
    const action = body.action;
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 200, headers });
      return;
    }
    if (action === 'version') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 6, error: null }) });
    } else if (action === 'deckNames') {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ result: ['Afrikaans', 'Afrikaans::Cloze', 'Default'], error: null }),
      });
    } else if (action === 'createDeck') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: 1, error: null }) });
    } else if (action === 'addNote') {
      // Return a real-looking timestamp-ish noteId.
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ result: Date.now(), error: null }),
      });
    } else {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: null, error: null }) });
    }
  }

  return calls;
}

test.describe('Vocab → Anki bulk export', () => {
  let vocabId: string;
  let ankiCalls: AnkiCall[];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    ankiCalls = await mockAnkiConnect(page);

    // Reset the user's persisted card-type choice so tests start from a known
    // state. NOTE: do not use addInitScript here — that would also fire on
    // page.reload() and defeat the persistence-across-reloads test below. We
    // clear once per test after the first navigation via page.evaluate.

    // Clear any stale ankiConnectUrl setting so the mock at localhost:8765
    // catches the requests. (Live dev may have configured a non-default port.)
    await page.request.delete('http://localhost:3456/api/settings/ankiConnectUrl').catch(() => {});

    // The sentence must contain the word (as real reader-mined vocab always
    // does) — a cloze note without a {{c1::}} blank is invalid and rejected.
    // Ending the sentence with the word + full stop regression-tests the
    // trailing-punctuation cloze bug (#108).
    const word = `e2etestword${Date.now().toString(36)}`;
    vocabId = await seedVocabEntry(
      page,
      word,
      `Dit is 'n e2e toets sin met ${word}.`,
      'This is an e2e test sentence.'
    );
  });

  test.afterEach(async ({ page }) => {
    if (vocabId) await deleteVocabEntry(page, vocabId);
  });

  test('opens the export modal and renders both card-type options', async ({ page }) => {
    await page.goto('/vocab');

    // Select our seeded entry via its checkbox.
    const row = page.getByRole('row').filter({ hasText: /e2etestword/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();

    await page.getByRole('button', { name: /Export to Anki/ }).click();

    const modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/1 word selected/i);
    await expect(modal.getByTestId('anki-card-type-basic')).toBeVisible();
    await expect(modal.getByTestId('anki-card-type-cloze')).toBeVisible();
    await expect(modal.getByTestId('anki-export-confirm')).toBeVisible();
  });

  test('Basic export sends an addNote with the Basic model to the Basic deck', async ({ page }) => {
    await page.goto('/vocab');
    const row = page.getByRole('row').filter({ hasText: /e2etestword/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Export to Anki/ }).click();

    const modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await modal.getByTestId('anki-card-type-basic').click();
    await modal.getByTestId('anki-export-confirm').click();

    await expect(page.getByText(/Exported 1 basic card to "Afrikaans"/)).toBeVisible({ timeout: 5000 });

    const addNote = ankiCalls.find((c) => c.action === 'addNote');
    expect(addNote).toBeDefined();
    expect(addNote!.params?.note?.modelName).toBe('Basic');
    expect(addNote!.params?.note?.deckName).toBe('Afrikaans');
  });

  test('Cloze export sends an addNote with the Cloze model to the Cloze deck', async ({ page }) => {
    await page.goto('/vocab');
    const row = page.getByRole('row').filter({ hasText: /e2etestword/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Export to Anki/ }).click();

    const modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await modal.getByTestId('anki-card-type-cloze').click();
    await modal.getByTestId('anki-export-confirm').click();

    await expect(page.getByText(/Exported 1 cloze card to "Afrikaans::Cloze"/)).toBeVisible({ timeout: 5000 });

    const addNote = ankiCalls.find((c) => c.action === 'addNote');
    expect(addNote).toBeDefined();
    expect(addNote!.params?.note?.modelName).toBe('Cloze');
    expect(addNote!.params?.note?.deckName).toBe('Afrikaans::Cloze');

    // The note must contain a real cloze blank, with the sentence-final
    // punctuation outside it (#108).
    const text = addNote!.params?.note?.fields?.Text ?? '';
    expect(text).toMatch(/\{\{c1::e2etestword[a-z0-9]+\}\}\./);
  });

  test('card type choice persists to localStorage across reloads', async ({ page }) => {
    // First visit — pick Cloze inside the modal.
    await page.goto('/vocab');
    const row = page.getByRole('row').filter({ hasText: /e2etestword/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Export to Anki/ }).click();
    const modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await modal.getByTestId('anki-card-type-cloze').click();

    // Verify the persisted value before exporting.
    const stored = await page.evaluate(() => localStorage.getItem('lector-anki-card-type'));
    expect(stored).toBe('cloze');

    // Reopen the modal — Cloze should be pre-selected. The tile's
    // `aria-pressed` attribute reflects the selected state.
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Export to Anki/ }).click();
    const modal2 = page.getByRole('dialog', { name: /Export to Anki/i });
    const clozeTile = modal2.getByTestId('anki-card-type-cloze');
    await expect(clozeTile).toHaveAttribute('aria-pressed', 'true');
  });

  test('already-synced entries are skipped on re-export', async ({ page }) => {
    await page.goto('/vocab');
    const row = page.getByRole('row').filter({ hasText: /e2etestword/ });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();

    // First export succeeds.
    await page.getByRole('button', { name: /Export to Anki/ }).click();
    let modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await modal.getByTestId('anki-card-type-basic').click();
    await modal.getByTestId('anki-export-confirm').click();
    await expect(page.getByText(/Exported 1 basic card/)).toBeVisible({ timeout: 5000 });

    const addNoteCallsAfterFirst = ankiCalls.filter((c) => c.action === 'addNote').length;
    expect(addNoteCallsAfterFirst).toBe(1);

    // Refresh so the row reflects pushedToAnki=true. Then try to export again.
    await page.reload();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Export to Anki/ }).click();
    modal = page.getByRole('dialog', { name: /Export to Anki/i });
    await modal.getByTestId('anki-export-confirm').click();

    // Expect the "already synced" notification, and NO additional addNote calls.
    await expect(page.getByText(/already been synced/i)).toBeVisible({ timeout: 5000 });
    const addNoteCallsAfterSecond = ankiCalls.filter((c) => c.action === 'addNote').length;
    expect(addNoteCallsAfterSecond).toBe(1);
  });
});
