import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

const COLLECTION = 'Latin E2E';

async function switchToLatin(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-la').first().click();
  await expect(selector).toContainText('Latina');
}

test.describe('Latin language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes macrons and defines a lemma', async ({ page }) => {
    await switchToLatin(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'la' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Bellum Gallicum',
        textContent: 'Gallia est omnis divisa in partes tres. Amāre est vīvere.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Gallia', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Amāre', { exact: true }).first()).toBeVisible();

    const word = page.getByText('partes', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API folds macrons and resolves a lemma', async ({ page }) => {
    const partes = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=partes&language=la'))
    ).json();
    expect(partes.entry?.word).toMatch(/part/i);

    const macron = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('amō')}&language=la`),
      )
    ).json();
    expect(macron.entry?.word).toBe('amo');
    expect(JSON.stringify(macron.entry)).toMatch(/love/i);

    const capitalized = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=GALLIA&language=la'))
    ).json();
    expect(capitalized.entry?.word).toBe('gallia');
  });

  test('cloze practice seeds and runs from the Latin bank', async ({ page }) => {
    await switchToLatin(page);
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

  test('TTS settings stay silent for a no-audio language', async ({ page }) => {
    await switchToLatin(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByTestId('no-audio-note')).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toHaveCount(0);
    await expect(tts.getByRole('button', { name: 'Test Voice' })).toHaveCount(0);
  });
});
