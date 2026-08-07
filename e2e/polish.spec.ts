import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Polish language pack: reader tokenization of the nine diacritic letters,
// on-device dictionary lookups that resolve seven cases and consonant
// alternation back to the lemma, the foreign-stem apostrophe split, and the
// cloze bank. Polish declares no new script seam — it is the pack that proves
// the engine needs none for a diacritic-heavy Latin language. Requires
// dictionary-pl.db in the e2e data dir (copied from data/ by the webServer
// bootstrap; fetched via dict.env pins in CI).

const COLLECTION = 'Polish E2E';

/** Switch the app to Polish through the real sidebar selector, so both the
 *  server setting and the client language cache agree — UI pages (reader,
 *  practice, settings) read the client cache. */
async function switchToPolish(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await page.getByTestId('language-option-pl').first().click();
  await expect(selector).toContainText('Polski');
}

test.describe('Polish language pack', () => {
  test.afterEach(async ({ page }) => {
    // Leave the shared dev DB on the default language for the other specs.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader tokenizes Polish diacritics and defines an inflected word', async ({ page }) => {
    await switchToPolish(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'pl' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Pierwszy rozdział',
        textContent:
          'Kupiłem nową książkę za pięćdziesiąt złotych. Żółw i gęś zjadły pączki w mieście.',
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // ż ó ł ę ś ć render inside one tappable token, not as fragments.
    await expect(page.getByText('Żółw', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('pięćdziesiąt', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('gęś', { exact: true }).first()).toBeVisible();

    // Tap-to-define an accusative form. kaikki carries książkę as its own
    // form-of entry, so the drawer names the case and links through to the
    // lemma (the nested-definition path, #106) rather than repeating "book".
    // Answering at all proves the on-device dictionary resolved it with no AI
    // fallback: the source badge says so.
    const word = page.getByText('książkę', { exact: true }).first();
    await expect(word).toBeVisible();
    await word.click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('accusative singular of', { exact: false })).toBeVisible({
      timeout: 10000,
    });
    await expect(drawer.getByRole('button', { name: 'książka' })).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible();
    // kaikki Polish carries IPA on the headwords, so the pack gets a phonetic
    // transcription for free — no rule generation, unlike Esperanto.
    await expect(drawer.getByText('/ˈkɕɔw̃ʂ.kɛ/', { exact: false })).toBeVisible();

    await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
  });

  test('the live lookup API resolves cases, alternation and aspect', async ({ page }) => {
    // Case forms resolve two different ways, and both have to work.
    //
    // 1. The dump carries most common forms as their OWN entry, whose gloss
    //    names the lemma. These hit on the exact match and so have no
    //    lemmaInfo — asserting one here would be asserting the wrong shape.
    for (const [form, lemma] of [
      ['książkę', 'książka'],
      ['nodze', 'noga'],
      ['mieście', 'miasto'],
    ]) {
      const res = await (
        await page.request.get(
          apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent(form)}&language=pl`),
        )
      ).json();
      expect(res.entry?.word, form).toBe(form);
      expect(JSON.stringify(res.entry?.senses), form).toContain(lemma);
    }

    // 2. A form the dump does NOT carry as an entry resolves through the
    //    inflections table instead, and that path does report the lemma.
    //    psowi → pies is also stem alternation (pies loses its e), which no
    //    affix rule could strip.
    const inflected = await (
      await page.request.get(apiUrl('/api/dictionary/lookup?word=psowi&language=pl'))
    ).json();
    expect(inflected.entry?.lemmaInfo?.stem).toBe('pies');
    expect(JSON.stringify(inflected.entry?.senses)).toContain('dog');

    // A sentence-initial capital folds to the same key under the DEFAULT
    // Unicode mapping — Polish needs no fold locale, unlike Turkish.
    const capitalized = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('ŻÓŁW')}&language=pl`),
      )
    ).json();
    expect(capitalized.entry?.word).toBe('żółw');

    // Both members of an aspect pair are their own entries.
    for (const verb of ['robić', 'zrobić']) {
      const res = await (
        await page.request.get(apiUrl(`/api/dictionary/lookup?word=${verb}&language=pl`))
      ).json();
      expect(res.entry?.word, verb).toBe(verb);
    }
  });

  test('cloze practice seeds and runs from the Polish bank', async ({ page }) => {
    await switchToPolish(page);
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // The pl sentence bank seeded (registry-driven) and a round can start.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    // A cloze card renders with an answer box to check.
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible({ timeout: 15000 });
  });

  test('TTS settings offer the Google/browser engines for a pl-PL voice', async ({ page }) => {
    await switchToPolish(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const tts = page.getByTestId('tts-settings');
    await expect(tts).toBeVisible();
    // Polish has a Google voice (pl-PL-Standard-F), so the engine picker is
    // present (the inverse of the espeak-only Esperanto case).
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeVisible();
    await expect(tts.getByTestId('espeak-voice-note')).toHaveCount(0);
  });
});
