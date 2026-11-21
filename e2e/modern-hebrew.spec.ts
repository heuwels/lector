import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Hebrew E2E';

async function switchToHebrew(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'he');
  await expect(selector).toContainText('עברית');
}

test.describe('Modern Hebrew language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader runs right to left and prints the pointed reading', async ({ page }) => {
    await switchToHebrew(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'he' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'פרק ראשון',
        textContent: 'הילד קרא ספר בבית. הכלב של צה"ל ישן ליד השולחן.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[dir="rtl"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('צה"ל', { exact: true }).first()).toBeVisible();

    const word = page.getByText('ספר', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByText(/séfer/)).toBeVisible();

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API folds niqqud and peels prefixes', async ({ page }) => {
    const lookup = async (word: string) =>
      (
        await page.request.get(
          apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(word)}&language=he`),
        )
      ).json();

    const pointed = await lookup('כֶּלֶב');
    expect(pointed.entry?.word).toBe('כלב');
    expect(pointed.entry?.ipa).toContain('kélev');
    expect(JSON.stringify(pointed.entry?.senses)).toMatch(/dog/i);

    const prefixed = await lookup('והכלבים');
    expect(JSON.stringify(prefixed.entry)).toMatch(/כלב/);

    const acronym = await lookup('צה"ל');
    expect(acronym.entry?.word).toBe('צה״ל');
  });

  test('cloze practice seeds and runs from the Hebrew bank', async ({ page }) => {
    await switchToHebrew(page);
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

  test('TTS settings offer the Google/browser engines for a he-IL voice', async ({ page }) => {
    await switchToHebrew(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
