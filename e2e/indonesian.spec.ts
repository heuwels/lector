import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Indonesian E2E';

async function switchToIndonesian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'id');
  await expect(selector).toContainText('Bahasa Indonesia');
}

test.describe('Indonesian language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes reduplication and defines a derived verb', async ({ page }) => {
    await switchToIndonesian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'id' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Bab pertama',
        textContent: 'Saya membeli buku-buku baru di toko buku.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('buku-buku', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('membeli', { exact: true }).first()).toBeVisible();

    const word = page.getByText('membeli', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a derived form', async ({ page }) => {
    const buku = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=buku&language=id'))
    ).json();
    expect(buku.entry?.word).toBe('buku');
    expect(JSON.stringify(buku.entry?.senses)).toContain('book');

    const membeli = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=membeli&language=id'))
    ).json();
    expect(membeli.entry?.word).toBe('membeli');

    const capitalized = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=Buku&language=id'))
    ).json();
    expect(capitalized.entry?.word).toBe('buku');
  });

  test('cloze practice seeds and runs from the Indonesian bank', async ({ page }) => {
    await switchToIndonesian(page);
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

  test('TTS settings offer the Google/browser engines for an id-ID voice', async ({ page }) => {
    await switchToIndonesian(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
