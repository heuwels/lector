import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * E2E for bulk delete on the /vocab page (#569).
 *
 * The e2e database is shared, so every test searches for a unique prefix first
 * and works only on the rows it seeded — the same approach as
 * vocab-pagination.spec.ts.
 *
 * Covers:
 *   - Select rows, confirm, and only those rows go
 *   - The count in the toast comes from the server, not the selection
 *   - Cancelling the confirm deletes nothing
 *   - The button is disabled until something is selected
 */

/** Seed `count` vocab entries sharing `prefix`. Returns their ids. */
async function seedVocab(page: Page, prefix: string, count: number): Promise<string[]> {
  const base = Date.now();
  const ids: string[] = [];
  await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      const text = `${prefix}-${String(n).padStart(4, '0')}`;
      const id = `e2e-bd-${text}`;
      ids.push(id);
      return page.request.post(apiUrl('/api/vocab'), {
        data: {
          id,
          text,
          type: 'word',
          sentence: `Sentence for ${text}.`,
          translation: `translation ${n}`,
          state: 'level1',
          stateUpdatedAt: new Date(base).toISOString(),
          reviewCount: 0,
          createdAt: new Date(base - n * 60000).toISOString(),
          pushedToAnki: false,
          language: 'af',
        },
      });
    }),
  );
  return ids;
}

test.describe('Vocab bulk delete', () => {
  let prefix: string;
  let ids: string[];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    prefix = `bdtest${Date.now().toString(36)}`;
    ids = await seedVocab(page, prefix, 3);
  });

  test.afterEach(async ({ page }) => {
    // Whatever a test left behind. Deleting an absent id is a harmless 404.
    await Promise.all(ids.map((id) => page.request.delete(apiUrl(`/api/vocab/${id}`))));
  });

  /** Narrow the list to this test's seeded rows, sorted by word ascending. */
  async function showSeededRows(page: Page) {
    await page.goto('/vocab');
    const search = page.getByPlaceholder(/Search words/i);
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(prefix);
    await page.getByRole('columnheader', { name: /Word\/Phrase/ }).click();
    return page.getByRole('row').filter({ hasText: new RegExp(prefix) });
  }

  test('deletes the selected rows and leaves the rest', async ({ page }) => {
    const rows = await showSeededRows(page);
    await expect(rows).toHaveCount(3);

    const deleteButton = page.getByRole('button', { name: /^Delete \(/ });
    await expect(deleteButton).toBeDisabled();

    // Tick the first two rows. The header checkbox is the first on the page,
    // so the row checkboxes start at index 1.
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await expect(deleteButton).toHaveText(/Delete \(2\)/);
    await expect(deleteButton).toBeEnabled();

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('2 vocab entries');
      dialog.accept();
    });
    await deleteButton.click();

    // The count comes back from the server, which is what makes it worth
    // asserting: it proves the API agreed the rows were there to delete.
    await expect(page.getByText('Deleted 2 of 2')).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('cell', { name: `${prefix}-0003`, exact: true })).toBeVisible();

    // The selection clears once the delete lands.
    await expect(deleteButton).toBeDisabled();
  });

  test('cancelling the confirm deletes nothing', async ({ page }) => {
    const rows = await showSeededRows(page);
    await rows.nth(0).getByRole('checkbox').check();

    const deleteButton = page.getByRole('button', { name: /^Delete \(/ });
    page.once('dialog', (dialog) => dialog.dismiss());
    await deleteButton.click();

    await expect(rows).toHaveCount(3);
    // The selection survives a cancel, so the user can confirm on a retry.
    await expect(deleteButton).toHaveText(/Delete \(1\)/);
  });

  test('select-all spans every filtered row, not just the visible page', async ({ page }) => {
    const rows = await showSeededRows(page);
    await page.getByLabel('Rows per page').selectOption('25');

    // The header checkbox is the only one outside a seeded row.
    await page.getByRole('checkbox').first().check();
    const deleteButton = page.getByRole('button', { name: /^Delete \(/ });
    await expect(deleteButton).toHaveText(/Delete \(3\)/);

    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();

    await expect(page.getByText('Deleted 3 of 3')).toBeVisible();
    await expect(rows).toHaveCount(0);
  });
});
