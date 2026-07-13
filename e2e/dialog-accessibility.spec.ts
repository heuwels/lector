import { expect, test } from '@playwright/test';
import { apiUrl } from './api';

const TITLE = 'Dialog Accessibility Test';

test.describe('Shared dialog accessibility', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    const collections = await page.request.get(apiUrl('/api/collections'));
    for (const collection of await collections.json()) {
      if (collection.title === TITLE) {
        await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
      }
    }

    const created = await page.request.post(apiUrl('/api/collections'), {
      data: { title: TITLE, language: 'af' },
    });
    collectionId = (await created.json()).id;
    await page.goto(`/collection/${collectionId}`);
    await expect(page.getByTestId('add-lesson')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('traps focus, closes with Escape, and restores trigger focus', async ({ page }) => {
    const trigger = page.getByTestId('add-lesson');
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Add lesson' });
    const title = page.locator('#lesson-title');
    const close = dialog.getByRole('button', { name: 'Close' });
    const cancel = dialog.getByRole('button', { name: 'Cancel' });

    await expect(dialog).toBeVisible();
    await expect(title).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.locator('[data-slot="dialog-viewport"]').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('labels and focuses the paste and web import dialogs', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByRole('button', { name: 'Paste Text' }).click();
    const pasteDialog = page.getByRole('dialog', { name: 'Paste Text' });
    await expect(pasteDialog).toBeVisible();
    await expect(page.locator('#paste-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pasteDialog).toBeHidden();

    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByRole('button', { name: 'Import from URL' }).click();
    const webDialog = page.getByRole('dialog', { name: 'Import from Web' });
    await expect(webDialog).toBeVisible();
    await expect(page.locator('#url-input')).toBeFocused();
  });
});
