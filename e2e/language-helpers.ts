import { expect, type Locator, type Page } from '@playwright/test';
import { apiUrl } from './api';

/**
 * Pick `code` in an open language picker. The picker lists only the languages
 * the account opted into (#442), so a language that is not listed is reached
 * through the "Add a language" section.
 *
 * Which section holds it comes from the settings API, not from the rendered
 * menu: the picker fills its list from an async read, so a DOM probe races it.
 */
export async function pickLanguage(page: Page, code: string) {
  const enabled = (await (
    await page.request.get(apiUrl('/api/settings/enabledLanguages'))
  ).json()) as string[] | null;
  const active = (await (await page.request.get(apiUrl('/api/settings/targetLanguage'))).json()) as
    | string
    | null;
  const listed = new Set([...(enabled ?? []), active]);

  if (listed.has(code)) {
    await page.getByTestId(`language-option-${code}`).first().click();
    return;
  }
  await page.getByTestId('language-add-toggle').first().click();
  await page.getByTestId(`language-add-option-${code}`).first().click();
}

/**
 * Switch the desktop sidebar picker to `code`, and wait for the reload to
 * settle on the new language.
 */
export async function switchLanguage(page: Page, code: string, nativeName: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector: Locator = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, code);
  await expect(selector).toContainText(nativeName);
}
