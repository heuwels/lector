import { describe, it, expect } from 'vitest';
import {
  tokenize,
  tokenizeWords,
  isWordChar,
  snapToWordBoundaries,
  splitSentences,
  countWords,
  type Token,
} from './index';
import { foldWord, normalizeText } from '../text';
import { LANGUAGES, type LanguageCode } from '../registry';
import type { LanguageConfig, ScriptConfig } from '../types';

// ---------------------------------------------------------------------------
// Byte-identical regression against the pre-#289 reader tokenizer
// ---------------------------------------------------------------------------

// The old WORD_PATTERN, kept verbatim as the oracle. Every shipped language
// must tokenize exactly as it did before the script-agnostic engine.
const LEGACY_WORD_PATTERN = /['‘’ʼ`]n\b|[\wÀ-ÖØ-öø-ž]+(?:-[\wÀ-ÖØ-öø-ž]+)*/gi;

function legacyWords(text: string): string[] {
  const re = new RegExp(LEGACY_WORD_PATTERN);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

const CORPUS: Record<LanguageCode, string[]> = {
  af: [
    'Hallo, hoe gaan dit met jou?',
    '’n Man loop in die straat. Sy sê: „Dit is ’n mooi dag!“',
    "ek's nie seker nie, dis 'n groot e-pos vir my pa-hulle.",
    'Woorde soos sê, môre, lêer en reën het kappies.',
    'Die boek is in 1999 geskryf — hoofstuk 3 is die beste.',
    'Ons gaan na die Klein-Karoo toe.',
  ],
  de: [
    'Hallo, wie geht es Ihnen?',
    'Die Häuser wurden 1999 gebaut, z.B. das E-Mail-Haus am Süd-West-Ufer.',
    '„Sind Sie sicher?“, fragte er. Über größere Straßen fußt man nicht.',
    'Das Mädchen aß süße Äpfel — und zwar viele!',
  ],
  es: [
    '¡Hola! ¿Cómo estás?',
    'El niño comió mañana; ¿por qué no?',
    'La canción número 42 es fantástica, ¿verdad?',
  ],
  fr: [
    'Bonjour ! Comment ça va ?',
    "L'eau est belle aujourd'hui, n'est-ce pas ?",
    "C'était l'été où j'ai vu «le grand œuvre» à Noël.",
  ],
  nl: [
    'Hallo, hoe gaat het met je?',
    "'t Is zo'n mooie dag, foto's van m'n huis.",
    "Hij zei: 'De brontosaurussen aten 's ochtends.'",
  ],
};

describe('tokenize — byte-identical with the legacy reader for shipped languages', () => {
  for (const [code, texts] of Object.entries(CORPUS) as [LanguageCode, string[]][]) {
    const pack = LANGUAGES[code];
    it(`matches the legacy word stream for ${code}`, () => {
      for (const text of texts) {
        const words = tokenizeWords(text, pack).map((t) => t.text);
        expect(words, text).toEqual(legacyWords(text));
      }
    });

    it(`reassembles ${code} text byte-for-byte with correct offsets`, () => {
      for (const text of texts) {
        const tokens = tokenize(text, pack);
        expect(tokens.map((t) => t.text).join('')).toBe(text);
        for (const t of tokens) {
          expect(text.slice(t.start, t.end)).toBe(t.text);
        }
      }
    });
  }

  it('keeps digits and underscores as word tokens (legacy \\w behavior)', () => {
    const de = LANGUAGES.de;
    expect(tokenizeWords('Kapitel 3 von 1999', de).map((t) => t.text)).toEqual([
      'Kapitel',
      '3',
      'von',
      '1999',
    ]);
    expect(tokenizeWords('my_var here', de).map((t) => t.text)).toEqual(['my_var', 'here']);
    expect(tokenizeWords('COVID-19 Fälle', de).map((t) => t.text)).toEqual(['COVID-19', 'Fälle']);
  });

  it("does not mistake a quote + capital N + accented letter for the 'n article (master bug)", () => {
    // Legacy \b was ASCII-only: in "‘Ná" it saw a word edge between N and á,
    // so the opening quote + N matched the article alternative and the á was
    // orphaned — ['‘N']['á']. The Unicode-aware boundary keeps "Ná" whole.
    const af = LANGUAGES.af;
    expect(tokenizeWords("‘Ná my kom 'n Man wat sterker is.'", af).map((t) => t.text)).toEqual([
      'Ná',
      'my',
      'kom',
      "'n",
      'Man',
      'wat',
      'sterker',
      'is',
    ]);
    // The article still matches before spaces/end (all-caps headings included).
    expect(tokenizeWords("'N NUWE DAG", af).map((t) => t.text)).toEqual(["'N", 'NUWE', 'DAG']);
    expect(tokenizeWords("dit is 'n", af).map((t) => t.text)).toEqual(['dit', 'is', "'n"]);
    // Quote + n + ASCII letter never matched (word chars follow) — unchanged.
    expect(tokenizeWords('‘nog een keer’', LANGUAGES.nl).map((t) => t.text)).toEqual([
      'nog',
      'een',
      'keer',
    ]);
  });

  it('joins true-hyphen codepoints U+2010/U+2011 like ASCII hyphens (upgrade over legacy)', () => {
    // Legacy split these; real hyphen codepoints inside compounds are the
    // same word, so the engine now keeps them whole (#289).
    const de = LANGUAGES.de;
    const withNbHyphen = 'E' + String.fromCharCode(0x2011) + 'Mail';
    expect(tokenizeWords(withNbHyphen, de).map((t) => t.text)).toEqual([withNbHyphen]);
  });

  it('treats en/em dashes as boundaries, exactly like legacy', () => {
    const de = LANGUAGES.de;
    const enDash = 'Paris' + String.fromCharCode(0x2013) + 'Dakar';
    expect(tokenizeWords(enDash, de).map((t) => t.text)).toEqual(['Paris', 'Dakar']);
  });
});

// ---------------------------------------------------------------------------
// Multi-script goldens — synthetic packs, zero per-language code (#289 exit)
// ---------------------------------------------------------------------------

function synth(script: Partial<ScriptConfig> & Pick<ScriptConfig, 'bcp47'>): LanguageConfig {
  return {
    ...LANGUAGES.af,
    script: {
      direction: 'ltr',
      kind: 'alpha-spaced',
      hasCase: true,
      ...script,
    },
  };
}

const ru = synth({ bcp47: 'ru' });
const grc = synth({ bcp47: 'grc', sentenceTerminators: '.;·' });
const ar = synth({ bcp47: 'ar', direction: 'rtl', hasCase: false, sentenceTerminators: '؟.!' });
const hbo = synth({ bcp47: 'he', direction: 'rtl', hasCase: false });
const ko = synth({ bcp47: 'ko', kind: 'hangul', hasCase: false });
const zh = synth({ bcp47: 'zh-Hans', kind: 'cjk-unspaced', hasCase: false, sentenceTerminators: '。．！？!?' });

describe('multi-script goldens (synthetic packs — no per-language code)', () => {
  it('tokenizes Russian, including hyphenated compounds', () => {
    expect(tokenizeWords('Привет, как дела? Хорошо-плохо.', ru).map((t) => t.text)).toEqual([
      'Привет',
      'как',
      'дела',
      'Хорошо-плохо',
    ]);
  });

  it('round-trips a Russian word through fold with no per-language code', () => {
    expect(foldWord('Привет', ru)).toBe('привет');
    const tokens = tokenizeWords('Привет мир', ru).map((t) => foldWord(t.text, ru));
    expect(tokens).toEqual(['привет', 'мир']);
  });

  it('tokenizes polytonic Greek with breathings and subscripts intact', () => {
    expect(tokenizeWords('Ἐν ἀρχῇ ἦν ὁ λόγος.', grc).map((t) => t.text)).toEqual([
      'Ἐν',
      'ἀρχῇ',
      'ἦν',
      'ὁ',
      'λόγος',
    ]);
  });

  it('tokenizes Arabic: Arabic-Indic digits and ،؟ are boundaries', () => {
    const words = tokenizeWords('كتب الولد ٢٠ رسالة، ماذا؟', ar).map((t) => t.text);
    expect(words).toEqual(['كتب', 'الولد', 'رسالة', 'ماذا']);
  });

  it('tokenizes pointed Hebrew: marks stay in the word, maqaf splits', () => {
    const words = tokenizeWords('בְּרֵאשִׁית אֵת־הַשָּׁמַיִם', hbo).map((t) => t.text);
    expect(words).toEqual(['בְּרֵאשִׁית', 'אֵת', 'הַשָּׁמַיִם']);
  });

  it('tokenizes Korean eojeol (spaced) with the same engine', () => {
    expect(tokenizeWords('안녕하세요? 저는 학생입니다.', ko).map((t) => t.text)).toEqual([
      '안녕하세요',
      '저는',
      '학생입니다',
    ]);
  });

  it('normalizes NFD Korean input to syllables before tokenizing', () => {
    const nfdWord = '한국'.normalize('NFD');
    expect(nfdWord.length).toBeGreaterThan(2);
    const tokens = tokenizeWords(normalizeText(nfdWord), ko).map((t) => t.text);
    expect(tokens).toEqual(['한국']);
  });

  it('falls back to letter-runs for unspaced CJK until the Phase 4 engine lands', () => {
    // Documents the interim contract: the seam dispatches, the default engine
    // keeps the run whole (one tap target), Intl.Segmenter lands in Phase 4.
    expect(tokenizeWords('我喜欢读书。', zh).map((t) => t.text)).toEqual(['我喜欢读书']);
  });
});

// ---------------------------------------------------------------------------
// Sentence splitting (0.6)
// ---------------------------------------------------------------------------

describe('splitSentences', () => {
  it('matches the legacy reader split for default terminators', () => {
    const text = 'Die kat slaap. Die hond blaf! Waar is hulle? Hier.';
    expect(splitSentences(text, LANGUAGES.af)).toEqual(
      text.split(/(?<=[.!?])\s+/),
    );
  });

  it('splits after abbreviation dots followed by space, exactly like legacy', () => {
    // Known, unchanged limitation: "z.B. " ends in dot+space, so the split
    // fires there — same as the pre-#289 reader. Dots with no following
    // whitespace ("z.B" mid-token) never split.
    expect(splitSentences('Das ist z.B. gut. Wirklich.', LANGUAGES.de)).toEqual([
      'Das ist z.B.',
      'gut.',
      'Wirklich.',
    ]);
  });

  it('uses the pack terminators (Arabic question mark)', () => {
    expect(splitSentences('ماذا؟ نعم.', ar)).toEqual(['ماذا؟', 'نعم.']);
  });

  it('uses the pack terminators (Greek ano teleia and erotimatiko)', () => {
    expect(splitSentences('τί ἐστιν· ἀληθῶς; ναί.', grc)).toEqual(['τί ἐστιν·', 'ἀληθῶς;', 'ναί.']);
  });
});

// ---------------------------------------------------------------------------
// Selection snapping (pure offsets)
// ---------------------------------------------------------------------------

describe('snapToWordBoundaries', () => {
  const af = LANGUAGES.af;

  it('expands a mid-word selection outward to the word', () => {
    const text = 'Die vrugte is lekker';
    //                ^5..7^ inside "vrugte" (4..10)
    expect(snapToWordBoundaries(text, 5, 7, af)).toEqual({ start: 4, end: 10 });
  });

  it('crosses apostrophes and hyphens like the legacy snapper', () => {
    const fr = LANGUAGES.fr;
    const text = "L'eau est claire";
    // inside "eau" — snapping crosses the elision apostrophe
    expect(snapToWordBoundaries(text, 3, 4, fr)).toEqual({ start: 0, end: 5 });

    const hy = 'die Klein-Karoo toe';
    expect(snapToWordBoundaries(hy, 6, 8, af)).toEqual({ start: 4, end: 15 });
  });

  it('stops at punctuation and whitespace', () => {
    const text = 'sê: "vrugte!"';
    expect(snapToWordBoundaries(text, 6, 8, af)).toEqual({ start: 5, end: 11 });
  });

  it('works on RTL text by logical offsets', () => {
    const text = 'קרא אֵת הספר';
    const snapped = snapToWordBoundaries(text, 5, 5, hbo);
    expect(text.slice(snapped.start, snapped.end)).toBe('אֵת');
  });
});

// ---------------------------------------------------------------------------
// countWords seam (0.4/4.6) and isWordChar
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('keeps the historical whitespace count for spaced scripts', () => {
    expect(countWords('# Titel\n\nDie *kat* slaap [hier](x).', LANGUAGES.af)).toBe(
      'Titel Die kat slaap hierx.'.split(/\s+/).length,
    );
    expect(countWords('een twee drie', LANGUAGES.nl)).toBe(3);
    expect(countWords('', LANGUAGES.af)).toBe(0);
  });

  it('accepts a missing pack (legacy callers)', () => {
    expect(countWords('een twee drie')).toBe(3);
  });
});

describe('isWordChar', () => {
  it('accepts letters of any script, digits and marks', () => {
    expect(isWordChar('a', LANGUAGES.af)).toBe(true);
    expect(isWordChar('ê', LANGUAGES.af)).toBe(true);
    expect(isWordChar('П', ru)).toBe(true);
    expect(isWordChar('ك', ar)).toBe(true);
    expect(isWordChar('한', ko)).toBe(true);
    expect(isWordChar('7', LANGUAGES.af)).toBe(true);
  });

  it('rejects spaces, punctuation and Arabic-Indic digits', () => {
    expect(isWordChar(' ', LANGUAGES.af)).toBe(false);
    expect(isWordChar('!', LANGUAGES.af)).toBe(false);
    expect(isWordChar('،', ar)).toBe(false);
    expect(isWordChar('٧', ar)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Token shape
// ---------------------------------------------------------------------------

describe('Token invariants', () => {
  it('word and gap tokens alternate correctly and cover the string', () => {
    const text = '  Hallo, wêreld!  ';
    const tokens: Token[] = tokenize(text, LANGUAGES.af);
    expect(tokens[0]).toEqual({ text: '  ', start: 0, end: 2, isWord: false });
    let pos = 0;
    for (const t of tokens) {
      expect(t.start).toBe(pos);
      pos = t.end;
    }
    expect(pos).toBe(text.length);
  });

  it('returns a single non-word token for wordless input', () => {
    expect(tokenize('?! …', LANGUAGES.af)).toEqual([
      { text: '?! …', start: 0, end: 4, isWord: false },
    ]);
  });

  it('returns [] for the empty string', () => {
    expect(tokenize('', LANGUAGES.af)).toEqual([]);
  });
});
