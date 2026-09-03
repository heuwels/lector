import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

// Scottish Gaelic language pack: apostrophe tokens, grave vowels, lenition
// lookup, and the cloze bank. Requires dictionary-gd.db in the e2e data dir
// (copied from data/ by the webServer bootstrap; fetched via dict.env pins in CI).

const COLLECTION = 'Gaelic E2E';

async function switchToGaelic(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'gd');
  await expect(selector).toContainText('Gàidhlig');
}

test.describe('Scottish Gaelic language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader keeps apostrophe words whole and defines a lenited noun', async ({ page }) => {
    await switchToGaelic(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'gd' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'A’ chiad leasan',
        textContent: "Tha a' bhean anns an taigh. Tha an cù mòr. Chunnaic mi dhuine.",
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText("a'", { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('bhean', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('taigh', { exact: true }).first()).toBeVisible();

    const word = page.getByText('taigh', { exact: true }).first();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByText('house', { exact: false }).first()).toBeVisible();

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a lenited form', async ({ page }) => {
    const duine = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=duine&language=gd'))
    ).json();
    expect(duine.entry?.word).toBe('duine');
    expect(JSON.stringify(duine.entry?.senses)).toContain('person');

    // dhuine is not a headword. The mutation map undoes lenition to duine.
    const dhuine = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=dhuine&language=gd'))
    ).json();
    expect(dhuine.entry?.word).toBe('duine');
  });

  test('cloze practice seeds and runs from the Gaelic bank', async ({ page }) => {
    await switchToGaelic(page);
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

  test('TTS settings absent the Google/browser engine picker for an espeak-only language', async ({
    page,
  }) => {
    await switchToGaelic(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toHaveCount(0);
    await expect(tts.getByRole('button', { name: 'Browser Built-in' })).toHaveCount(0);
  });
});
