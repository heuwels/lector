import { expect, test, type Page } from '@playwright/test';
import { apiUrl } from './api';

async function seedEntry(page: Page) {
  const id = `e2e-vocab-edit-${Date.now().toString(36)}`;
  const text = `editword${Date.now().toString(36)}`;
  const response = await page.request.post(apiUrl('/api/vocab'), {
    data: {
      id,
      text,
      type: 'word',
      sentence: `A sentence containing ${text}.`,
      translation: 'original meaning',
      state: 'level1',
      reviewCount: 0,
      pushedToAnki: false,
      language: 'af',
    },
  });
  expect(response.ok()).toBeTruthy();
  return { id, text };
}

async function openEntry(page: Page, text: string) {
  await page.goto('/vocab');
  await expect(page.getByRole('row').filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('cell', { name: text, exact: true }).click();
  await expect(page.getByRole('heading', { name: text })).toBeVisible();
}

test.describe('vocab detail edits', () => {
  test('persists a translation across reload and keeps failed edits unsaved', async ({ page }) => {
    const entry = await seedEntry(page);
    try {
      await openEntry(page, entry.text);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByTestId('vocab-translation-edit').fill('persisted meaning');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Entry updated successfully')).toBeVisible();

      await page.reload();
      await openEntry(page, entry.text);
      await expect(
        page.getByTestId('vocab-detail-modal').getByText('persisted meaning', { exact: true }),
      ).toBeVisible();

      await page.route(`**/api/vocab/${entry.id}`, async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'storage unavailable' }),
        });
      });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByTestId('vocab-translation-edit').fill('must not persist');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Failed to update entry')).toBeVisible();
      await expect(page.getByTestId('vocab-translation-edit')).toHaveValue('must not persist');

      await page.unroute(`**/api/vocab/${entry.id}`);
      const stored = await page.request.get(apiUrl(`/api/vocab/${entry.id}`));
      expect((await stored.json()).translation).toBe('persisted meaning');
    } finally {
      await page.request.delete(apiUrl(`/api/vocab/${entry.id}`));
    }
  });
});
