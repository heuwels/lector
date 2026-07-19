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
