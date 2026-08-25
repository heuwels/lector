import { describe, it, expect } from 'vitest';
import {
  arabicLooseKey,
  foldArabicKey,
  foldWord,
  latinLookupVariants,
  normalizeText,
} from './text';
import { LANGUAGES } from './registry';
import type { LanguageConfig } from './types';

const af = LANGUAGES.af;
const de = LANGUAGES.de;

// Synthetic caseless pack, af's data under an ar-shaped script. Deliberately
// NOT the real ar pack: `code` stays 'af', so foldWord takes the caseless path
// WITHOUT the Arabic fold, which is what these cases are about. The Arabic fold
// has its own block below.
const caseless: LanguageConfig = {
  ...af,
  script: { bcp47: 'ar', direction: 'rtl', kind: 'alpha-spaced', hasCase: false },
};

const COMBINING_CIRCUMFLEX = String.fromCharCode(0x0302);

describe('normalizeText', () => {
  it('composes decomposed sequences to NFC', () => {
    const decomposed = 'se' + COMBINING_CIRCUMFLEX;
    expect(decomposed).toHaveLength(3);
    expect(normalizeText(decomposed)).toBe('sê');
    expect(normalizeText(decomposed)).toHaveLength(2);
  });

  it('strips soft hyphens, zero-width spaces, word joiners and BOMs', () => {
    expect(normalizeText('Wo­rt')).toBe('Wort'); // soft hyphen (EPUBs)
    expect(normalizeText('﻿hallo')).toBe('hallo'); // BOM
    expect(normalizeText('een​twee')).toBe('eentwee'); // zero-width space
    expect(normalizeText('a⁠b')).toBe('ab'); // word joiner
  });

  it('keeps ZWNJ/ZWJ and directional marks (orthographic / bidi-meaningful)', () => {
    expect(normalizeText('a‌b')).toBe('a‌b'); // ZWNJ
    expect(normalizeText('a‍b')).toBe('a‍b'); // ZWJ
    expect(normalizeText('a‎b')).toBe('a‎b'); // LRM
  });

  it('folds the polytonic Greek oxia duplicates to tonos', () => {
    // U+1F71 (alpha + oxia) and U+03AC (alpha + tonos) render identically and
    // both appear in real polytonic text — NFC maps the first to the second,
    // which is the classic Greek vocab-key gotcha (#254).
    expect(normalizeText('ά')).toBe('ά');
  });

  it('composes Korean jamo to syllables (NFD input is otherwise fatal, #258)', () => {
    expect(normalizeText('한')).toBe('한'); // 한
  });

  it('is a no-op on already-NFC text', () => {
    const text = 'Die Häuser wurden sê môre gebaut.';
    expect(normalizeText(text)).toBe(text);
  });
});

describe('foldWord', () => {
  it('is NFC + lowercase for cased scripts (byte-identical to the old keying)', () => {
    expect(foldWord('Häuser', de)).toBe('häuser');
    expect(foldWord('VRUGTE', af)).toBe('vrugte');
    expect(foldWord('môre', af)).toBe('môre');
  });

  it('folds decomposed input onto the same key as precomposed', () => {
    const decomposed = 'SE' + COMBINING_CIRCUMFLEX;
    expect(foldWord(decomposed, af)).toBe(foldWord('sê', af));
  });

  it('drops soft hyphens from keys', () => {
    expect(foldWord('Häu­ser', de)).toBe('häuser');
  });

  it('skips lowercasing for caseless scripts', () => {
    const word = 'كتاب';
    expect(foldWord(word, caseless)).toBe(word);
  });

  it('folds Cyrillic and Greek case, which SQLite LOWER() cannot', () => {
    const ru: LanguageConfig = {
      ...af,
      script: { bcp47: 'ru', direction: 'ltr', kind: 'alpha-spaced', hasCase: true },
    };
    expect(foldWord('Привет', ru)).toBe('привет');
    const grc: LanguageConfig = {
      ...af,
      script: { bcp47: 'grc', direction: 'ltr', kind: 'alpha-spaced', hasCase: true },
    };
    expect(foldWord('Λόγος', grc)).toBe('λόγος');
  });

  it('is idempotent', () => {
    const once = foldWord('Môre', af);
    expect(foldWord(once, af)).toBe(once);
  });

  // The dotted/dotless i is the one place the default Unicode lowercasing
  // gives a wrong key rather than an unusual one: `İyi` would fold to
  // i + U+0307 + 'yi', which no dictionary entry matches, and `ILIK`
  // ("lukewarm") would fold onto `ilik` ("marrow") — a different word.
  describe('Turkish dotted/dotless i (script.caseFoldLocale)', () => {
    const tr = LANGUAGES.tr;

    it('folds the dotted capital İ to a plain i, with no leftover dot', () => {
      expect(foldWord('İyi', tr)).toBe('iyi');
      expect(foldWord('İSTANBUL', tr)).toBe('istanbul');
      expect(foldWord('DİL', tr)).toBe('dil');
      expect(foldWord('İyi', tr)).not.toContain('̇');
    });

    it('folds the dotless capital I to ı, keeping the two words apart', () => {
      expect(foldWord('ILIK', tr)).toBe('ılık');
      expect(foldWord('IŞIK', tr)).toBe('ışık');
      expect(foldWord('ILIK', tr)).not.toBe(foldWord('İLİK', tr));
    });

    it('agrees with itself on mixed-case and already-lower input', () => {
      expect(foldWord('Işık', tr)).toBe(foldWord('IŞIK', tr));
      expect(foldWord('ışık', tr)).toBe('ışık');
    });

    it('is idempotent', () => {
      const once = foldWord('İSTANBUL', tr);
      expect(foldWord(once, tr)).toBe(once);
    });

    it('leaves packs without a fold locale on plain Unicode lowercasing', () => {
      // Same input, no caseFoldLocale: German keeps the default mapping, so
      // the Turkish rule can't leak into another pack's keys.
      expect(foldWord('ILIK', de)).toBe('ilik');
    });
  });

  // The Ukrainian apostrophe is a letter, and text in the wild spells it with
  // whichever variant its source produced. kaikki writes the headwords with
  // ASCII ', so the fold has to agree on one spelling or the lookup misses.
  describe('Ukrainian apostrophe (script.foldApostrophes)', () => {
    const uk = LANGUAGES.uk;

    it('folds every apostrophe variant to the ASCII one', () => {
      expect(foldWord('п’ять', uk)).toBe("п'ять");
      expect(foldWord('пʼять', uk)).toBe("п'ять");
      expect(foldWord('пʹять', uk)).toBe("п'ять");
      expect(foldWord('п`ять', uk)).toBe("п'ять");
      expect(foldWord('п´ять', uk)).toBe("п'ять");
      expect(foldWord("п'ять", uk)).toBe("п'ять");
    });

    it('folds case and apostrophe together', () => {
      expect(foldWord("З'ЇЗД", uk)).toBe("з'їзд");
      expect(foldWord('Здоров’я', uk)).toBe("здоров'я");
    });

    it('is idempotent', () => {
      const once = foldWord('Ім’я', uk);
      expect(foldWord(once, uk)).toBe(once);
    });

    it('folds Italian elisions to the ASCII apostrophe', () => {
      expect(foldWord("C'è", LANGUAGES.it)).toBe("c'è");
      expect(foldWord('C’è', LANGUAGES.it)).toBe("c'è");
      expect(foldWord("L'ITALIANO", LANGUAGES.it)).toBe("l'italiano");
      expect(foldWord('un’amica', LANGUAGES.it)).toBe("un'amica");
    });

    it('leaves packs without the flag alone', () => {
      // French spells l'eau with an apostrophe too, but the pack splits on it
      // and never folds — its keys must stay byte-stable.
      expect(foldWord('L’EAU', LANGUAGES.fr)).toBe('l’eau');
      expect(foldWord('Türkiye’nin', LANGUAGES.tr)).toBe('türkiye’nin');
    });
  });

  describe('Latin macron and ligature keys (#256)', () => {
    const la = LANGUAGES.la;

    it('strips macrons so amāre and amare are one key', () => {
      expect(foldWord('amāre', la)).toBe('amare');
      expect(foldWord('Amāre', la)).toBe('amare');
      expect(foldWord('AMĀRE', la)).toBe('amare');
    });

    it('unfolds æ and œ', () => {
      expect(foldWord('Cæsar', la)).toBe('caesar');
      expect(foldWord('cœlum', la)).toBe('coelum');
    });

    it('is idempotent', () => {
      const once = foldWord('Amāre', la);
      expect(foldWord(once, la)).toBe(once);
    });
  });
});

const ar = LANGUAGES.ar;

describe('Arabic keys (#253)', () => {
  it('strips the tashkeel a newspaper never writes', () => {
    // The dump's own canonical form against the same word in running text.
    expect(foldWord('كَتَبَ', ar)).toBe('كتب');
    expect(foldWord('مَدْرَسَة', ar)).toBe('مدرسة');
    // Shadda and sukun too, not only the short vowels.
    expect(foldWord('كُلّ', ar)).toBe('كل');
    expect(foldWord('مِنْ', ar)).toBe('من');
  });

  it('strips the tatweel, which is a justification glyph and not a letter', () => {
    expect(foldWord('مــدرسة', ar)).toBe('مدرسة');
    expect(foldWord('كتـــاب', ar)).toBe('كتاب');
  });

  it('folds every alef spelling onto bare alef', () => {
    // Real text writes the hamza inconsistently: wordfreq's Arabic top thirty
    // holds both أن and ان, which is one word under two spellings.
    expect(foldWord('أن', ar)).toBe('ان');
    expect(foldWord('إلى', ar)).toBe('الى');
    expect(foldWord('آخر', ar)).toBe('اخر');
    expect(foldWord('ٱلله', ar)).toBe('الله');
    expect(foldWord('أن', ar)).toBe(foldWord('ان', ar));
  });

  it('leaves the hamza on waw and ya alone', () => {
    // Those two are precomposed single code points that NFC never takes apart,
    // and they are written consistently. Folding them would merge unrelated
    // keys for no gain.
    expect(foldWord('مؤخرا', ar)).toBe('مؤخرا');
    expect(foldWord('شئ', ar)).toBe('شئ');
  });

  it('does not lowercase, because Arabic has no case', () => {
    expect(ar.script.hasCase).toBe(false);
    expect(foldWord('Wi-Fi', ar)).toBe('Wi-Fi');
  });

  it('folds a decomposed alef through NFC first', () => {
    // NFD splits أ into ا + U+0654. normalizeText recomposes it, and only then
    // does the alef fold see a single code point to map.
    const decomposed = 'أن'.normalize('NFD');
    expect(decomposed).not.toBe('أن');
    expect(foldWord(decomposed, ar)).toBe('ان');
  });

  it('is idempotent', () => {
    const once = foldArabicKey('إِلَى');
    expect(foldArabicKey(once)).toBe(once);
  });
});

describe('arabicLooseKey (#253)', () => {
  it('folds ta marbuta onto ha', () => {
    expect(arabicLooseKey('مدرسة')).toBe('مدرسه');
  });

  it('folds alef maqsura onto ya', () => {
    expect(arabicLooseKey('على')).toBe('علي');
    expect(arabicLooseKey('فى')).toBe('في');
  });

  it('brings the two spellings of one word together', () => {
    // The whole point: مدرسه typed for مدرسة has to reach the same row, and it
    // does because the build stores this form as an alias.
    expect(arabicLooseKey('مدرسة')).toBe(arabicLooseKey('مدرسه'));
    expect(arabicLooseKey('فى')).toBe(arabicLooseKey('في'));
  });

  it('leaves a word with neither letter untouched', () => {
    expect(arabicLooseKey('كتاب')).toBe('كتاب');
  });

  it('is not applied to the key itself', () => {
    // foldWord must NOT fold these, or a genuine minimal pair would lose its
    // own entry. The loose form exists only as a fallback.
    expect(foldWord('مدرسة', ar)).toBe('مدرسة');
    expect(foldWord('على', ar)).toBe('على');
  });
});

describe('latinLookupVariants', () => {
  it('swaps u/v and i/j after the exact key misses', () => {
    expect(latinLookupVariants('vult')).toContain('uult');
    expect(latinLookupVariants('iam')).toContain('jam');
    expect(latinLookupVariants('amare')).toEqual([]);
  });
});
