import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Hungarian E2E';

async function switchToHungarian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'hu');
  await expect(selector).toContainText('Magyar');
}

test.describe('Hungarian language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes ő ű and defines a word', async ({ page }) => {
    await switchToHungarian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'hu' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Első fejezet',
        textContent: 'Vettem egy új könyvet. A ház a kertben áll.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('könyvet', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('ház', { exact: true }).first()).toBeVisible();

    const word = page.getByText('ház', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a case form', async ({ page }) => {
    const haz = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('ház')}&language=hu`),
      )
    ).json();
    expect(haz.entry?.word).toBe('ház');
    expect(JSON.stringify(haz.entry?.senses)).toMatch(/house|home/i);

    const konyvet = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('könyvet')}&language=hu`),
      )
    ).json();
    expect(JSON.stringify(konyvet.entry)).toMatch(/könyv/i);

    const capitalized = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('HÁZ')}&language=hu`),
      )
    ).json();
    expect(capitalized.entry?.word).toBe('ház');
  });

  test('cloze practice seeds and runs from the Hungarian bank', async ({ page }) => {
    await switchToHungarian(page);
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

  test('TTS settings offer the Google/browser engines for a hu-HU voice', async ({ page }) => {
    await switchToHungarian(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
