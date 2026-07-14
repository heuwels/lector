import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Esperanto language pack (#307): reader tokenization of the supersignoj,
// on-device dictionary lookups with the rule-generated IPA gloss, x-system
// query folding, eSpeak-only TTS (no Google voice exists for eo), and the
// cloze bank. Requires dictionary-eo.db in the e2e data dir (copied from
// data/ by the webServer bootstrap; fetched via dict.env pins in CI) and the
// espeak-ng binary (installed by the CI jobs; baked into the Docker image).

const COLLECTION = 'Esperanto E2E';

/** Switch the app to Esperanto through the real sidebar selector, so both the
 *  server setting and the client language cache agree — UI pages (reader,
 *  practice, settings) read the client cache. */
async function switchToEsperanto(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-eo').first().click();
  await expect(selector).toContainText('Esperanto');
}

test.describe('Esperanto language pack', () => {
  test.afterEach(async ({ page }) => {
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes supersignoj, dictionary defines them with rule IPA, espeak speaks them', async ({
    page,
  }) => {
    await switchToEsperanto(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'eo' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Ĉapitro 1',
        textContent: 'La ĝardeno estas bela. Ŝi aĉetis ĉokoladon kaj ĵurnalon hodiaŭ.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // The supersigno word renders as one tappable token (U+011D sits inside
    // the tokenizer's letter class — the whole word, not fragments).
    const word = page.getByText('ĝardeno', { exact: true }).first();
    await expect(word).toBeVisible({ timeout: 10000 });

    // Tap-to-define: the on-device dictionary answers (no AI fallback) and the
    // entry carries the rule-generated IPA gloss (#307 §3.2b).
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'ĝardeno' })).toBeVisible();
    await expect(drawer.getByText('garden', { exact: false }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByText('/d͡ʒarˈdeno/')).toBeVisible();

    // The speaker goes through the server's eSpeak NG engine — Esperanto has
    // no Google or browser voice, so the response must be real WAV audio, not
    // a fallback flag (#307 §3.2c).
    const ttsResponse = page.waitForResponse('**/api/tts');
    await drawer.getByRole('button', { name: 'Hear pronunciation' }).click();
    const tts = await (await ttsResponse).json();
    expect(tts.contentType).toBe('audio/wav');
    expect(tts.fallback).toBeUndefined();
    expect(tts.audioContent.length).toBeGreaterThan(1000);

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('x-system queries and rule morphology resolve through the live lookup API', async ({
    page,
  }) => {
    // cx/gx/ux digraphs fold to the supersignoj at the query boundary (§3.4)…
    const xSystem = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=gxardeno&language=eo'))
    ).json();
    expect(xSystem.entry?.word).toBe('ĝardeno');
    expect(xSystem.entry?.ipa).toBe('/d͡ʒarˈdeno/');

    // …and the accusative x-system form still lands on the dictionary (kaikki
    // carries the form-of entry; the surface form keeps its own rule IPA).
    const inflected = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=gxardenon&language=eo'))
    ).json();
    expect(inflected.entry?.word).toBe('ĝardenon');
    expect(inflected.entry?.ipa).toBe('/d͡ʒarˈdenon/');

    // Productive derivations kaikki never enumerated ground through the
    // deterministic analyzer (§3.3).
    const compound = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=futbalisto&language=eo'))
    ).json();
    expect(compound.entry?.lemmaInfo).toEqual({ stem: 'futbalo', label: '-ist- form of' });
  });

  test('cloze practice seeds and runs from the Esperanto bank', async ({ page }) => {
    await switchToEsperanto(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // The eo sentence bank seeded (registry-driven) and a round can start.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    // A cloze card renders with an answer box to check.
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });

  test('TTS settings absent the Google/browser engine picker for an espeak-only language', async ({
    page,
  }) => {
    await switchToEsperanto(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    // The synthesized-voice note replaces the engine picker…
    await expect(tts.getByTestId('espeak-voice-note')).toBeVisible();
    // …and the Google-language controls are gone (no doomed managed-TTS
    // probe, no browser-voice toggle that could mis-speak).
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toHaveCount(0);
    await expect(tts.getByRole('button', { name: 'Browser Built-in' })).toHaveCount(0);
  });
});
