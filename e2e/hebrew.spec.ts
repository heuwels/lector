import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Biblical Hebrew E2E';

async function switchToBiblicalHebrew(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'hbo');
  await expect(selector).toContainText('עברית מקראית');
}

async function lookup(page: Page, word: string) {
  const res = await page.request.get(
    apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(word)}&language=hbo`),
  );
  return res.json();
}

test.describe('Biblical Hebrew language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader renders pointed text right to left and keeps a maqaf pair whole', async ({
    page,
  }) => {
    await switchToBiblicalHebrew(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'hbo' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'בראשית',
        textContent:
          'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃ וַיִּכְרְתוּ גַם־שְׁנֵיהֶם בְּרִית׃',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[dir="rtl"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('גַם־שְׁנֵיהֶם', { exact: true }).first()).toBeVisible();

    const word = page.getByText('בְּרֵאשִׁית', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API strips niqqud and resolves a maqaf pair', async ({ page }) => {
    const pointed = await lookup(page, 'בְּרֵאשִׁית');
    expect(JSON.stringify(pointed.entry?.senses)).toMatch(/beginning/i);

    const created = await lookup(page, 'בָּרָא');
    expect(JSON.stringify(created.entry?.senses)).toMatch(/create/i);

    const pair = await lookup(page, 'גַם־שְׁנֵיהֶם');
    expect(pair.entry?.word).toBe('שניהם');
  });

  test('cloze practice seeds and runs from the Tanakh bank', async ({ page }) => {
    await switchToBiblicalHebrew(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });
});
