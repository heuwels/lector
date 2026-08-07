import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Ukrainian language pack: reader tokenization of the four letters Russian does
// not have (ґ є і ї), the apostrophe joiner (script.extraJoiners — the first
// pack where an apostrophe is a letter rather than an elision mark), the
// apostrophe-variant key fold, on-device dictionary lookups, and the cloze
// bank. Requires dictionary-uk.db in the e2e data dir (copied from data/ by the
// webServer bootstrap; fetched via dict.env pins in CI).

const COLLECTION = 'Ukrainian E2E';

/** Switch the app to Ukrainian through the real sidebar selector, so both the
 *  server setting and the client language cache agree — UI pages (reader,
 *  practice, settings) read the client cache. */
async function switchToUkrainian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-uk').first().click();
  await expect(selector).toContainText('Українська');
}

test.describe('Ukrainian language pack', () => {
  test.afterEach(async ({ page }) => {
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader keeps an apostrophe word whole and defines it', async ({ page }) => {
    await switchToUkrainian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'uk' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Перший розділ',
        textContent:
          "Я з'їв п'ять яблук сьогодні. Ґудзик на її сорочці зник, і вона їсть їжу без нього.",
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // ґ і ї є render inside one tappable token, not as fragments.
    await expect(page.getByText('Ґудзик', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('їжу', { exact: true }).first()).toBeVisible();

    // The reported bug: the apostrophe must not split the word. "п'ять" is one
    // token, so it is one tappable word — and neither "п" nor "ять" exists.
    const word = page.getByText("п'ять", { exact: true }).first();
    await expect(word).toBeVisible();
    await expect(page.getByText('ять', { exact: true })).toHaveCount(0);

    // Tap-to-define answers from the on-device dictionary (no AI fallback),
    // which only happens if the whole apostrophe word reached the lookup.
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('five', { exact: false }).first()).toBeVisible({
      timeout: 10000,
    });

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API folds every apostrophe variant to one entry', async ({ page }) => {
    // kaikki writes the headwords with ASCII ', but real text arrives with
    // whichever variant its source produced. All three must hit one entry.
    for (const spelling of ["п'ять", 'п’ять', 'пʼять', "П'ЯТЬ"]) {
      const res = await (
        await page.request.get(
          apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(spelling)}&language=uk`),
        )
      ).json();
      expect(res.entry?.word, spelling).toBe("п'ять");
    }

    // The word the pack exists for: Ukrainian "так" is "yes", which the Russian
    // dictionary glosses only as "like that".
    const yes = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('Так')}&language=uk`),
      )
    ).json();
    expect(yes.entry?.word).toBe('так');
    expect(JSON.stringify(yes.entry?.senses)).toContain('yes');

    // Inflection: a case form the dump does not carry as its own entry resolves
    // back to its lemma through the inflections table, apostrophe included on
    // both sides.
    const inflected = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('п’ятницями')}&language=uk`),
      )
    ).json();
    expect(inflected.entry?.lemmaInfo?.stem).toBe("п'ятниця");

    // A ґ word: outside the contiguous Cyrillic range, so it proves the
    // alphabet is complete rather than а-я only.
    const soil = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('ґрунт')}&language=uk`),
      )
    ).json();
    expect(soil.entry?.word).toBe('ґрунт');
  });

  test('cloze practice seeds and runs from the Ukrainian bank', async ({ page }) => {
    await switchToUkrainian(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // The uk sentence bank seeded (registry-driven) and a round can start.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    // A cloze card renders with an answer box to check.
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });

  test('TTS settings offer the Google/browser engines for a uk-UA voice', async ({ page }) => {
    await switchToUkrainian(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    // Ukrainian has a Google voice (uk-UA-Standard-B), so the engine picker is
    // present (the inverse of the espeak-only Esperanto case).
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
