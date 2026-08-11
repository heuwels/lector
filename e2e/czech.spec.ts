import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Czech language pack: reader tokenization of the háček, acute and kroužek
// letters, on-device dictionary lookups that resolve seven cases and stem
// alternation back to the lemma, and the cloze bank. Czech declares no new
// script seam — it is the second pack, after Polish, to prove the engine needs
// none for a diacritic-heavy Latin language. Requires dictionary-cs.db in the
// e2e data dir (copied from data/ by the webServer bootstrap; fetched via
// dict.env pins in CI).

const COLLECTION = 'Czech E2E';

/** Switch the app to Czech through the real sidebar selector, so both the
 *  server setting and the client language cache agree — UI pages (reader,
 *  practice, settings) read the client cache. */
async function switchToCzech(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-cs').first().click();
  await expect(selector).toContainText('Čeština');
}

test.describe('Czech language pack', () => {
  test.afterEach(async ({ page }) => {
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes Czech diacritics and defines an inflected word', async ({ page }) => {
    await switchToCzech(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'cs' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'První kapitola',
        textContent:
          'Koupil jsem novou knihu za padesát korun. Příliš žluťoučký kůň úpěl ďábelské ódy.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // ž ť ů ň ď é render inside one tappable token, not as fragments.
    await expect(page.getByText('žluťoučký', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('kůň', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ďábelské', { exact: true }).first()).toBeVisible();

    // Tap-to-define an accusative form. kaikki carries knihu as its own form-of
    // entry, so the drawer names the case and links through to the lemma (the
    // nested-definition path, #106) rather than repeating "book". Answering at
    // all proves the on-device dictionary resolved it with no AI fallback: the
    // source badge says so.
    const word = page.getByText('knihu', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('accusative singular of', { exact: false })).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByRole('button', { name: 'kniha' })).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible();
    // kaikki Czech carries IPA on the headwords, so the pack gets a phonetic
    // transcription for free. Note the delimiter: Czech is transcribed in
    // square brackets, where Polish uses slashes — the dump decides, and the
    // drawer prints what the dump wrote.
    await expect(drawer.getByText('[ˈkɲɪɦu]', { exact: false })).toBeVisible();

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves cases, alternation and aspect', async ({ page }) => {
    // Case forms resolve two different ways, and both have to work.
    //
    // 1. The dump carries most common forms as their OWN entry, whose gloss
    //    names the lemma. These hit on the exact match and so have no
    //    lemmaInfo — asserting one here would be asserting the wrong shape.
    for (const [form, lemma] of [
      ['knihu', 'kniha'],
      ['městě', 'město'],
      ['psovi', 'pes'],
    ]) {
      const res = await (
        await page.request.get(
          apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(form)}&language=cs`),
        )
      ).json();
      expect(res.entry?.word, form).toBe(form);
      expect(JSON.stringify(res.entry?.senses), form).toContain(lemma);
    }

    // 2. A form the dump does NOT carry as an entry resolves through the
    //    inflections table instead, and that path does report the lemma.
    //    koňmi → kůň is also stem alternation (the kroužek ů shortens to o),
    //    which no affix rule could strip.
    const inflected = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('koňmi')}&language=cs`),
      )
    ).json();
    expect(inflected.entry?.lemmaInfo?.stem).toBe('kůň');
    expect(JSON.stringify(inflected.entry?.senses)).toContain('horse');

    // A sentence-initial capital folds to the same key under the DEFAULT
    // Unicode mapping — Czech needs no fold locale, unlike Turkish.
    const capitalized = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('KŮŇ')}&language=cs`),
      )
    ).json();
    expect(capitalized.entry?.word).toBe('kůň');

    // Vowel length is contrastive, so the acute must survive keying: byt (a
    // flat) and být (to be) are separate entries, not one folded key.
    const shortVowel = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=byt&language=cs'))
    ).json();
    expect(JSON.stringify(shortVowel.entry?.senses)).toContain('apartment');
    const longVowel = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('být')}&language=cs`),
      )
    ).json();
    expect(JSON.stringify(longVowel.entry?.senses)).toContain('to be');

    // Both members of an aspect pair are their own entries.
    for (const verb of ['dělat', 'udělat']) {
      const res = await (
        await page.request.get(
          apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(verb)}&language=cs`),
        )
      ).json();
      expect(res.entry?.word, verb).toBe(verb);
    }
  });

  test('cloze practice seeds and runs from the Czech bank', async ({ page }) => {
    await switchToCzech(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // The cs sentence bank seeded (registry-driven) and a round can start.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    // A cloze card renders with an answer box to check.
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });

  test('TTS settings offer the Google/browser engines for a cs-CZ voice', async ({ page }) => {
    await switchToCzech(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    // Czech has a Google voice (cs-CZ-Standard-B), so the engine picker is
    // present (the inverse of the espeak-only Esperanto case).
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
