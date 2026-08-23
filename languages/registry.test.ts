import { describe, it, expect } from 'vitest';
import { getAllLanguages, LANGUAGES } from './registry';

// Pronunciation-capability conformance (#307 §3.2). The type system can't
// express "ttsCode is required iff the pack declares the google engine", so
// this guards the seam every consumer dispatches on: the tts route (engine
// choice), the client speak() (fallback rules), and the speaker UI (absent
// itself on 'none').
describe('registry pronunciation conformance', () => {
  it('every pack declares a valid audio capability', () => {
    for (const lang of getAllLanguages()) {
      const { audio } = lang.pronunciation;
      if (audio === 'none') continue;
      expect(audio.length, `${lang.code} audio list must not be empty`).toBeGreaterThan(0);
      for (const engine of audio) {
        expect(['google', 'espeak'], `${lang.code} engine ${engine}`).toContain(engine);
      }
    }
  });

  it('packs declaring the google engine carry the Google voice fields', () => {
    for (const lang of getAllLanguages()) {
      const { audio } = lang.pronunciation;
      if (audio !== 'none' && audio.includes('google')) {
        expect(lang.ttsCode, `${lang.code} needs ttsCode for Google TTS`).toBeTruthy();
        expect(lang.ttsVoice, `${lang.code} needs ttsVoice for Google TTS`).toBeTruthy();
      }
    }
  });

  it('koine greek is audio-none with no voice fields (first no-audio pack)', () => {
    const grc = LANGUAGES.grc;
    // Reconstructed/disputed pronunciation — nothing may speak it (#307 §3.2a):
    // the speaker UI absents itself rather than mis-speaking via a wrong voice.
    expect(grc.pronunciation.audio).toBe('none');
    expect(grc.ttsCode).toBeUndefined();
    expect(grc.ttsVoice).toBeUndefined();
    expect(grc.script.practiceLeniency).toBe('fold-marks');
    expect(grc.script.sentenceTerminators).toBe('.;·');
  });

  it('latin is audio-none with macron folding and no voice fields', () => {
    const la = LANGUAGES.la;
    expect(la.pronunciation.audio).toBe('none');
    expect(la.ttsCode).toBeUndefined();
    expect(la.ttsVoice).toBeUndefined();
    expect(la.tatoebaCode).toBe('lat');
    expect(la.script.bcp47).toBe('la');
    expect(la.script.kind).toBe('alpha-spaced');
    expect(la.script.hasCase).toBe(true);
    expect(la.script.practiceLeniency).toBe('fold-marks');
    expect(la.flag).toBe('\u{1F3DB}\u{FE0F}');
  });

  // A fold locale changes how every vocab and dictionary key is written, so it
  // must stay opt-in: one pack declares it, and the dictionary build mirrors
  // the same value in its tr profile.
  it('only the Turkish pack declares a case-fold locale', () => {
    const withLocale = getAllLanguages().filter((lang) => lang.script.caseFoldLocale);
    expect(withLocale.map((lang) => lang.code)).toEqual(['tr']);
    expect(LANGUAGES.tr.script.caseFoldLocale).toBe('tr');
    expect(LANGUAGES.tr.tatoebaCode).toBe('tur');
    expect(LANGUAGES.tr.script.hasCase).toBe(true);
  });

  // The apostrophe seam is the same kind of opt-in as the fold locale: it moves
  // a token boundary and changes how keys are written, so exactly one pack may
  // declare it, and the dictionary build mirrors the flag in its uk profile.
  it('only the Ukrainian pack joins and folds the apostrophe', () => {
    const withJoiners = getAllLanguages().filter((lang) => lang.script.extraJoiners);
    expect(withJoiners.map((lang) => lang.code)).toEqual(['uk']);
    const withFold = getAllLanguages().filter((lang) => lang.script.foldApostrophes);
    expect(withFold.map((lang) => lang.code)).toEqual(['uk']);

    const uk = LANGUAGES.uk;
    expect(uk.tatoebaCode).toBe('ukr');
    expect(uk.script.bcp47).toBe('uk');
    expect(uk.script.hasCase).toBe(true);
    // Every variant the fold maps must also join, or a curly-apostrophe word
    // would tokenize as two words and then key as one.
    expect(uk.script.extraJoiners).toContain("'");
    for (const variant of ['‘', '’', 'ʼ', 'ʹ', '`', '´']) {
      expect(uk.script.extraJoiners, `variant ${variant} must join`).toContain(variant);
    }
    // Russian is the pack this was confused with — it must be unaffected.
    expect(LANGUAGES.ru.script.extraJoiners).toBeUndefined();
    expect(LANGUAGES.ru.script.foldApostrophes).toBeUndefined();
  });

  // Polish and Czech are the control cases for both opt-in seams: each has
  // diacritics like tr and an apostrophe like uk, but needs neither flag. If a
  // later change makes one of them apply by default, this fails.
  it.each([
    ['pl', 'pol'],
    ['cs', 'ces'],
    ['id', 'ind'],
    ['sv', 'swe'],
  ] as const)('%s declares no fold locale and no apostrophe seam', (code, tatoebaCode) => {
    const pack = LANGUAGES[code];
    expect(pack.script.caseFoldLocale).toBeUndefined();
    expect(pack.script.extraJoiners).toBeUndefined();
    expect(pack.script.foldApostrophes).toBeUndefined();
    expect(pack.script.extraWordChars).toBeUndefined();
    expect(pack.script.extraTokenPatterns).toBeUndefined();
    expect(pack.tatoebaCode).toBe(tatoebaCode);
    expect(pack.script.bcp47).toBe(code);
    expect(pack.script.hasCase).toBe(true);
    expect(pack.script.kind).toBe('alpha-spaced');
  });

  it('esperanto is espeak-voiced with a rule-generated IPA gloss', () => {
    const eo = LANGUAGES.eo;
    expect(eo.pronunciation.audio).toEqual(['espeak']);
    expect(eo.pronunciation.gloss).toBe('ipa');
    expect(eo.tatoebaCode).toBe('epo');
    // No Google voice exists for Esperanto — the fields must stay absent so
    // nothing accidentally routes it at a Google or browser voice.
    expect(eo.ttsCode).toBeUndefined();
    expect(eo.ttsVoice).toBeUndefined();
  });
});
