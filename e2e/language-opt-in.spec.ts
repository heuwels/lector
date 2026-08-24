import { test, expect, type Page } from '@playwright/test';
import { apiUrl } from './api';

// Opting in to languages (#442). The picker lists the languages the account
// chose, and "Add a language" reaches the rest of the registry.

async function resetToAfrikaans(page: Page) {
  await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  await page.request.put(apiUrl('/api/settings/enabledLanguages'), { data: { value: ['af'] } });
}

async function openSidebarPicker(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  return selector;
}

test.describe('Opting in to languages', () => {
  test.beforeEach(async ({ page }) => {
    await resetToAfrikaans(page);
  });

  test.afterEach(async ({ page }) => {
    await resetToAfrikaans(page);
  });

  test('the picker lists the chosen languages and hides the rest behind Add', async ({ page }) => {
    await openSidebarPicker(page);

    await expect(page.getByTestId('language-option-af').first()).toBeVisible();
    await expect(page.getByTestId('language-option-pt')).toHaveCount(0);
    await expect(page.getByTestId('language-add-option-pt')).toHaveCount(0);

    await page.getByTestId('language-add-toggle').first().click();
    await expect(page.getByTestId('language-add-option-pt').first()).toBeVisible();
    // A chosen language is never offered twice.
    await expect(page.getByTestId('language-add-option-af')).toHaveCount(0);
  });

  test('adding a language switches to it and lists it next time', async ({ page }) => {
    const selector = await openSidebarPicker(page);

    await page.getByTestId('language-add-toggle').first().click();
    await page.getByTestId('language-add-option-pt').first().click();
    await expect(selector).toContainText('Português');

    const stored = await page.request.get(apiUrl('/api/settings/enabledLanguages'));
    expect(await stored.json()).toEqual(['af', 'pt']);

    // Listed from now on, so it is no longer behind the Add section.
    await selector.click();
    await expect(page.getByTestId('language-option-pt').first()).toBeVisible();
    await expect(page.getByTestId('language-add-option-pt')).toHaveCount(0);
  });

  test('Settings removes a language and the picker drops it', async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/enabledLanguages'), {
      data: { value: ['af', 'pt'] },
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const section = page.getByTestId('languages-settings');
    await expect(section.getByTestId('enabled-language-af')).toBeVisible();
    await expect(section.getByTestId('enabled-language-pt')).toBeVisible();

    // Afrikaans is in use, so only the other language offers a remove control.
    await expect(section.getByTestId('remove-language-af')).toHaveCount(0);
    await section.getByTestId('remove-language-pt').click();
    await expect(section.getByTestId('enabled-language-pt')).toHaveCount(0);

    const stored = await page.request.get(apiUrl('/api/settings/enabledLanguages'));
    expect(await stored.json()).toEqual(['af']);

    await page.locator('aside').getByTestId('language-selector').click();
    await expect(page.getByTestId('language-option-pt')).toHaveCount(0);
  });

  test('Settings adds a language without switching to it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const section = page.getByTestId('languages-settings');
    await section.getByTestId('add-language-select').selectOption('pt');
    await section.getByTestId('add-language').click();
    await expect(section.getByTestId('enabled-language-pt')).toBeVisible();

    const active = await page.request.get(apiUrl('/api/settings/targetLanguage'));
    expect(await active.json()).toBe('af');

    await page.locator('aside').getByTestId('language-selector').click();
    await expect(page.getByTestId('language-option-pt').first()).toBeVisible();
  });
});
