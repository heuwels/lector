import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

const COLLECTION = 'Italian E2E';

async function switchToItalian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-it').first().click();
  await expect(selector).toContainText('Italiano');
}

test.describe('Italian language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader keeps an elision whole and defines the content word', async ({ page }) => {
    await switchToItalian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'it' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Primo capitolo',
        textContent: "C'è l'italiano qui. Un'amica beve l'acqua.",
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // The reported bug: the apostrophe must not split the word.
    await expect(page.getByText("C'è", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("l'italiano", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Un'amica", { exact: true }).first()).toBeVisible();
    await expect(page.getByText('italiano', { exact: true })).toHaveCount(0);
    await expect(page.getByText('amica', { exact: true })).toHaveCount(0);

    const word = page.getByText("l'italiano", { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Italian', { exact: false }).first()).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API peels an elision and folds the apostrophe', async ({ page }) => {
    const peeled = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent("l'italiano")}&language=it`),
      )
    ).json();
    expect(peeled.entry?.lemmaInfo?.stem ?? peeled.entry?.word).toBe('italiano');

    const curly = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('l’italiano')}&language=it`),
      )
    ).json();
    expect(curly.entry?.lemmaInfo?.stem ?? curly.entry?.word).toBe('italiano');
  });
});
