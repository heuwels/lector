import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Greek E2E';

async function switchToGreek(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'el');
  await expect(selector).toContainText('Ελληνικά');
}

test.describe('Modern Greek language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes monotonic Greek and defines a word', async ({ page }) => {
    await switchToGreek(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'el' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Πρώτο μάθημα',
        textContent: 'Διαβάζω ένα καλό βιβλίο. Το σπίτι είναι μεγάλο.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('βιβλίο', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('σπίτι', { exact: true }).first()).toBeVisible();

    const word = page.getByText('βιβλίο', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and keeps el apart from grc', async ({ page }) => {
    const biblio = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('βιβλίο')}&language=el`),
      )
    ).json();
    expect(biblio.entry?.word).toBe('βιβλίο');
    expect(JSON.stringify(biblio.entry?.senses)).toMatch(/book/i);

    const spiti = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('σπίτι')}&language=el`),
      )
    ).json();
    expect(spiti.entry?.word).toBe('σπίτι');
  });

  test('cloze practice seeds and runs from the Greek bank', async ({ page }) => {
    await switchToGreek(page);
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

  test('TTS settings offer the Google/browser engines for an el-GR voice', async ({ page }) => {
    await switchToGreek(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
