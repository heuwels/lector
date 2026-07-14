import { describe, it, expect } from 'vitest';
import { esperantoIpa } from './ipa';

// Expected values follow Wiktionary's Esperanto transcriptions; the phoneme
// stream is additionally cross-checkable with `espeak-ng -v eo --ipa` (which
// marks stress before the vowel instead of the onset but agrees on phonemes).
describe('esperantoIpa', () => {
  it('maps every special phoneme letter', () => {
    expect(esperantoIpa('paco')).toBe('/ˈpat͡so/'); // c → t͡s
    expect(esperantoIpa('ĉambro')).toBe('/ˈt͡ʃambro/'); // ĉ → t͡ʃ
    expect(esperantoIpa('ĝardeno')).toBe('/d͡ʒarˈdeno/'); // ĝ → d͡ʒ
    expect(esperantoIpa('ĥoro')).toBe('/ˈxoro/'); // ĥ → x
    expect(esperantoIpa('ĵurnalo')).toBe('/ʒurˈnalo/'); // ĵ → ʒ
    expect(esperantoIpa('ŝipo')).toBe('/ˈʃipo/'); // ŝ → ʃ
    expect(esperantoIpa('aŭto')).toBe('/ˈawto/'); // ŭ → w
    expect(esperantoIpa('gusto')).toBe('/ˈɡusto/'); // g → ɡ (IPA U+0261)
  });

  it('always stresses the penultimate syllable', () => {
    expect(esperantoIpa('saluton')).toBe('/saˈluton/');
    expect(esperantoIpa('ĉokolado')).toBe('/t͡ʃokoˈlado/');
    expect(esperantoIpa('esperanto')).toBe('/espeˈranto/');
    expect(esperantoIpa('malsanulejo')).toBe('/malsanuˈlejo/');
  });

  it('treats j and ŭ as glides, not syllable nuclei', () => {
    // ho·di·aŭ — the final aŭ is one syllable, so di carries the stress.
    expect(esperantoIpa('hodiaŭ')).toBe('/hoˈdiaw/');
    // do·moj — the -oj diphthong is one syllable.
    expect(esperantoIpa('domoj')).toBe('/ˈdomoj/');
    expect(esperantoIpa('antaŭ')).toBe('/ˈantaw/');
    // fa·mi·li·o — i before a vowel IS syllabic (no diphthong), stress on li.
    expect(esperantoIpa('familio')).toBe('/famiˈlio/');
  });

  it('keeps obstruent+liquid onsets whole (muta cum liquida)', () => {
    expect(esperantoIpa('kompreni')).toBe('/komˈpreni/');
    expect(esperantoIpa('instrui')).toBe('/insˈtrui/');
    expect(esperantoIpa('ekzemplo')).toBe('/ekˈzemplo/');
  });

  it('takes the whole initial cluster when the stressed vowel is the first', () => {
    expect(esperantoIpa('scii')).toBe('/ˈst͡sii/');
    expect(esperantoIpa('knabo')).toBe('/ˈknabo/');
  });

  it('leaves monosyllables unmarked', () => {
    expect(esperantoIpa('kaj')).toBe('/kaj/');
    expect(esperantoIpa('la')).toBe('/la/');
    expect(esperantoIpa('plej')).toBe('/plej/');
  });

  it('handles case and the poetic o-elision', () => {
    expect(esperantoIpa('Esperanto')).toBe('/espeˈranto/');
    expect(esperantoIpa('ĈOKOLADO')).toBe('/t͡ʃokoˈlado/');
    expect(esperantoIpa("mond'")).toBe('/mond/');
    expect(esperantoIpa("l'")).toBe('/l/');
  });

  it('returns null for input it cannot confidently transliterate', () => {
    expect(esperantoIpa('')).toBeNull();
    expect(esperantoIpa('xylofono')).toBeNull(); // x is not an Esperanto letter
    expect(esperantoIpa('COVID-19')).toBeNull();
    expect(esperantoIpa('du vortoj')).toBeNull(); // space
    expect(esperantoIpa("d'oh!")).toBeNull(); // internal apostrophe + !
  });
});
