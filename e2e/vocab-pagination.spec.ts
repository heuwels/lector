import { test, expect, Page } from '@playwright/test';

/**
 * E2E for the /vocab page list pagination (#66).
 *
 * The vocab list loads its full set into memory and paginates client-side. To
 * keep assertions deterministic against a shared e2e database (other specs may
 * have seeded rows), every test first types a unique prefix into the search box
 * so the working set is exactly the rows this test seeded.
 *
 * Covers:
 *   - Only one page of rows renders; the rest are paged behind Next
 *   - Page label, prev/next enabled state, and forward/back navigation
 *   - Rows-per-page changes the page size, resets to page 1, and persists
 *   - Changing the filter resets back to page 1
 *   - No pagination control (and an empty-state message) when nothing matches
 */

const SEED_COUNT = 30; // 25 on page one, 5 on page two at the smallest page size

/** Seed `count` vocab entries sharing `prefix`, with zero-padded sortable text. */
async function seedVocab(page: Page, prefix: string, count: number): Promise<string[]> {
  const base = Date.now();
  const ids: string[] = [];
  await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      const text = `${prefix}-${String(n).padStart(4, '0')}`;
      const id = `e2e-pg-${text}`;
      ids.push(id);
      // Space createdAt apart so any createdAt-ordered view is also stable.
      // Relative URL — resolved against the config baseURL (portable across ports).
      return page.request.post('http://localhost:3457/api/vocab', {
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

test.describe('Vocab list pagination', () => {
  let prefix: string;
  let ids: string[];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    prefix = `pgtest${Date.now().toString(36)}`;
    ids = await seedVocab(page, prefix, SEED_COUNT);
  });

  test.afterEach(async ({ page }) => {
    await Promise.all(ids.map((id) => page.request.delete(`http://localhost:3457/api/vocab/${id}`)));
  });

  /** Narrow the list to just this test's seeded rows and sort them by word asc. */
  async function showSeededRows(page: Page) {
    await page.goto('/vocab');
    const search = page.getByPlaceholder(/Search words/i);
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(prefix);
    // Sort by Word/Phrase ascending for a deterministic -0001..-0030 order.
    await page.getByRole('columnheader', { name: /Word\/Phrase/ }).click();
    return page.getByRole('row').filter({ hasText: new RegExp(prefix) });
  }

  test('caps rendered rows to one page and navigates with Next/Prev', async ({ page }) => {
    const rows = await showSeededRows(page);

    // Default page size is 50, so all 30 seeded rows fit on one page.
    await expect(rows).toHaveCount(SEED_COUNT);
    const pagination = page.getByTestId('vocab-pagination');
    await expect(pagination).toBeVisible();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 1 of 1');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

    // Drop to the smallest page size → two pages (25 + 5).
    await page.getByLabel('Rows per page').selectOption('25');
    await expect(rows).toHaveCount(25);
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 1 of 2');
    await expect(page.getByTestId('vocab-pagination-range')).toHaveText(/1.25 of 30/);
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled();

    // Page one shows -0001..-0025; page two's first row (-0026) is absent.
    await expect(page.getByRole('cell', { name: `${prefix}-0001`, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: `${prefix}-0026`, exact: true })).toHaveCount(0);

    // Go to page two.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 2 of 2');
    await expect(page.getByTestId('vocab-pagination-range')).toHaveText(/26.30 of 30/);
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    await expect(page.getByRole('cell', { name: `${prefix}-0026`, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: `${prefix}-0001`, exact: true })).toHaveCount(0);

    // Back to page one.
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 1 of 2');
    await expect(page.getByRole('cell', { name: `${prefix}-0001`, exact: true })).toBeVisible();
  });

  test('rows-per-page persists across reloads and changing it resets to page 1', async ({
    page,
  }) => {
    await showSeededRows(page);

    await page.getByLabel('Rows per page').selectOption('25');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 2 of 2');

    // Re-selecting a page size resets to page 1.
    await page.getByLabel('Rows per page').selectOption('100');
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 1 of 1');

    // Go back to 25 and reload — the choice is persisted in localStorage.
    await page.getByLabel('Rows per page').selectOption('25');
    expect(await page.evaluate(() => localStorage.getItem('lector-vocab-page-size'))).toBe('25');
    await page.reload();
    await expect(page.getByLabel('Rows per page')).toHaveValue('25');
  });

  test('changing the filter resets pagination back to page 1', async ({ page }) => {
    await showSeededRows(page);
    await page.getByLabel('Rows per page').selectOption('25');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 2 of 2');

    // Narrowing the search changes the result set → snap back to page 1.
    await page.getByPlaceholder(/Search words/i).fill(`${prefix}-001`);
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 1 of 1');
  });

  test('sorting keeps the current page (same set, reordered)', async ({ page }) => {
    await showSeededRows(page);
    await page.getByLabel('Rows per page').selectOption('25');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 2 of 2');

    // Re-sort by a different column: the set is unchanged, only reordered, so
    // pagination deliberately stays on page 2 (it does not snap back to 1).
    await page.getByRole('columnheader', { name: /Date Added/ }).click();
    await expect(page.getByTestId('vocab-pagination-page')).toHaveText('Page 2 of 2');
  });

  test('hides the pagination control and shows an empty state when nothing matches', async ({
    page,
  }) => {
    await page.goto('/vocab');
    const search = page.getByPlaceholder(/Search words/i);
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('zzz-no-such-vocab-zzz');

    await expect(page.getByText(/No entries match your filters/i)).toBeVisible();
    await expect(page.getByTestId('vocab-pagination')).toHaveCount(0);
  });
});
