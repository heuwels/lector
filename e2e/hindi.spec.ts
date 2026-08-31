import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

// Hindi language pack: reader tokenization of Devanagari (matras, virama,
// nukta stay inside the token; danda and Devanagari digits are boundaries),
// on-device dictionary lookups, and the cloze bank. Requires dictionary-hi.db
// in the e2e data dir (copied from data/ by the webServer bootstrap).

const COLLECTION = 'Hindi E2E';

async function switchToHindi(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'hi');
  await expect(selector).toContainText('हिन्दी');
}

test.describe('Hindi language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes Devanagari and defines a word', async ({ page }) => {
    await switchToHindi(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'hi' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'पहला पाठ',
        textContent: 'मैं एक किताब पढ़ता हूँ। यह पानी ठंडा है।',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('किताब', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('पढ़ता', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('पानी', { exact: true }).first()).toBeVisible();

    const word = page.getByText('किताब', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByText('book', { exact: false }).first()).toBeVisible();

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a nukta spelling', async ({ page }) => {
    const kitab = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('किताब')}&language=hi`),
      )
    ).json();
    expect(kitab.entry?.word).toBe('किताब');
    expect(JSON.stringify(kitab.entry?.senses)).toContain('book');

    const pani = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('पानी')}&language=hi`),
      )
    ).json();
    expect(pani.entry?.word).toBe('पानी');

    // क + nukta and the precomposed क़ are one key after NFC.
    const decomposed = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('क\u093C')}&language=hi`),
      )
    ).json();
    const composed = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('क़')}&language=hi`),
      )
    ).json();
    expect(decomposed.entry?.word).toBe(composed.entry?.word);
  });

  test('cloze practice seeds and runs from the Hindi bank', async ({ page }) => {
    await switchToHindi(page);
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

  test('TTS settings offer the Google/browser engines for a hi-IN voice', async ({ page }) => {
    await switchToHindi(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
