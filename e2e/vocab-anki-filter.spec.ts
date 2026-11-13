import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * Vocab list: the Anki sync status filter.
 *   - "In Anki" shows only the entries that are in Anki (pushedToAnki).
 *   - "Not in Anki" shows only the others.
 *   - "Anki: all" shows both.
 */

async function seed(page: Page, id: string, text: string, pushedToAnki: boolean) {
  const now = new Date().toISOString();
  await page.request.post(apiUrl('/api/vocab'), {
    data: {
      id,
      text,
      type: 'word',
      sentence: `Sentence for ${text}.`,
      translation: 'translation',
      state: 'level1',
      stateUpdatedAt: now,
      reviewCount: 0,
      createdAt: now,
      pushedToAnki,
      language: 'af',
    },
  });
}

test.describe('Vocab Anki filter', () => {
  const prefix = `ankifilter${Date.now().toString(36)}`;
  const synced = { id: `e2e-af-${prefix}-in`, text: `${prefix}-in` };
  const unsynced = { id: `e2e-af-${prefix}-out`, text: `${prefix}-out` };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page, synced.id, synced.text, true);
    await seed(page, unsynced.id, unsynced.text, false);
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete(apiUrl(`/api/vocab/${synced.id}`));
    await page.request.delete(apiUrl(`/api/vocab/${unsynced.id}`));
  });

  test('filters the list by Anki sync status', async ({ page }) => {
    await page.goto('/vocab');
    const search = page.getByPlaceholder(/Search words/i);
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(prefix);

    const rows = page.getByRole('row').filter({ hasText: new RegExp(prefix) });
    await expect(rows).toHaveCount(2);

    // A selection does not survive a filter that hides its rows.
    await page.getByLabel('Select all on this page').check();
    const deleteButton = page.getByRole('button', { name: /^Delete \(/ });
    await expect(deleteButton).toHaveText(/Delete \(2\)/);

    const filter = page.getByLabel('Anki sync status');
    await filter.selectOption('in-anki');
    await expect(deleteButton).toHaveText(/Delete \(1\)/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(synced.text);

    await filter.selectOption('not-in-anki');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(unsynced.text);

    await filter.selectOption('all');
    await expect(rows).toHaveCount(2);
  });
});
