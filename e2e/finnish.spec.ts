import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Finnish E2E';

async function switchToFinnish(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'fi');
  await expect(selector).toContainText('Suomi');
}

test.describe('Finnish language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes ä ö and defines a word', async ({ page }) => {
    await switchToFinnish(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'fi' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Ensimmäinen luku',
        textContent: 'Ostin uuden kirjan. Tämä päivä on kaunis.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('kirjan', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('päivä', { exact: true }).first()).toBeVisible();

    const word = page.getByText('kirjan', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a case form', async ({ page }) => {
    const kirja = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=kirja&language=fi'))
    ).json();
    expect(kirja.entry?.word).toBe('kirja');
    expect(JSON.stringify(kirja.entry?.senses)).toMatch(/book/i);

    const kirjan = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=kirjan&language=fi'))
    ).json();
    expect(JSON.stringify(kirjan.entry)).toMatch(/kirja/i);

    const capitalized = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('PÄIVÄ')}&language=fi`),
      )
    ).json();
    expect(capitalized.entry?.word).toBe('päivä');
  });

  test('cloze practice seeds and runs from the Finnish bank', async ({ page }) => {
    await switchToFinnish(page);
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

  test('TTS settings offer the Google/browser engines for a fi-FI voice', async ({ page }) => {
    await switchToFinnish(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
