import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Norwegian E2E';

async function switchToNorwegian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'nb');
  await expect(selector).toContainText('Norsk');
}

test.describe('Norwegian language pack', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes æ ø å and defines a definite form', async ({ page }) => {
    await switchToNorwegian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'nb' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Første kapittel',
        textContent: 'Jeg kjøpte en ny bok. Her er en rød bjørn ved sjøen.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('bjørn', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('sjøen', { exact: true }).first()).toBeVisible();

    const word = page.getByText('bok', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves a lemma and a definite form', async ({ page }) => {
    const bok = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=bok&language=nb'))
    ).json();
    expect(bok.entry?.word).toBe('bok');
    expect(JSON.stringify(bok.entry?.senses)).toMatch(/book/i);

    const huset = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=huset&language=nb'))
    ).json();
    const husetBlob = JSON.stringify(huset.entry);
    expect(husetBlob).toMatch(/hus/);

    const capitalized = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('BJØRN')}&language=nb`),
      )
    ).json();
    expect(capitalized.entry?.word).toBe('bjørn');
  });

  test('cloze practice seeds and runs from the Norwegian bank', async ({ page }) => {
    await switchToNorwegian(page);
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

  test('TTS settings offer the Google/browser engines for an nb-NO voice', async ({ page }) => {
    await switchToNorwegian(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
