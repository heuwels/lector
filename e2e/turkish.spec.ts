import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

// Turkish language pack: reader tokenization of the Turkish letters, on-device
// dictionary lookups that resolve stacked suffixes back to the lemma, the
// dotted/dotless i case fold (script.caseFoldLocale — the one place the default
// Unicode lowercasing gives a wrong key), and the cloze bank. Requires
// dictionary-tr.db in the e2e data dir (copied from data/ by the webServer
// bootstrap; fetched via dict.env pins in CI).

const COLLECTION = 'Turkish E2E';

/** Switch the app to Turkish through the real sidebar selector, so both the
 *  server setting and the client language cache agree — UI pages (reader,
 *  practice, settings) read the client cache. */
async function switchToTurkish(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'tr');
  await expect(selector).toContainText('Türkçe');
}

test.describe('Turkish language pack', () => {
  test.afterEach(async ({ page }) => {
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes Turkish letters and defines a capitalized dotless I word', async ({
    page,
  }) => {
    await switchToTurkish(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'tr' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Birinci Bölüm',
        textContent: 'Işık söndü ve oda karanlık oldu. Öğrenciler kitaplarını çantaya koydular.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // ş/ğ/ü/ı render inside one tappable token, not as fragments.
    await expect(page.getByText('söndü', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Öğrenciler', { exact: true }).first()).toBeVisible();

    // Tap-to-define the sentence-initial "Işık": the on-device dictionary
    // answers (no AI fallback) only if the capital dotless I folded to ı. The
    // default Unicode mapping would look up "işik", which does not exist.
    const word = page.getByText('Işık', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('light', { exact: false }).first()).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API folds dotted/dotless i and unstacks suffixes', async ({ page }) => {
    // A capital İ folds to a plain i, with no combining dot left to miss on…
    const dotted = await (
      await page.request.get(apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('İyi')}&language=tr`))
    ).json();
    expect(dotted.entry?.word).toBe('iyi');

    // …and a capital I folds to ı, which keeps the two letters apart: ılık
    // ("lukewarm") and ilik ("marrow") must stay separate entries.
    const dotless = await (
      await page.request.get(apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('ILIK')}&language=tr`))
    ).json();
    expect(dotless.entry?.word).toBe('ılık');
    const marrow = await (
      await page.request.get(apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('İLİK')}&language=tr`))
    ).json();
    expect(marrow.entry?.word).toBe('ilik');

    // Agglutination: a noun carrying plural + possessive + case resolves to its
    // lemma, and a conjugated verb to its infinitive.
    const noun = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=evlerimizden&language=tr'))
    ).json();
    expect(noun.entry?.lemmaInfo?.stem).toBe('ev');
    const verb = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=gidiyorum&language=tr'))
    ).json();
    expect(verb.entry?.lemmaInfo?.stem).toBe('gitmek');
  });

  test('cloze practice seeds and runs from the Turkish bank', async ({ page }) => {
    await switchToTurkish(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // The tr sentence bank seeded (registry-driven) and a round can start.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    // A cloze card renders with an answer box to check.
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });

  test('TTS settings offer the Google/browser engines for a tr-TR voice', async ({ page }) => {
    await switchToTurkish(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    // Turkish has a Google voice, so the engine picker is present (the inverse
    // of the espeak-only Esperanto case).
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
