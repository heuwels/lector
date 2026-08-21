import { describe, it, expect } from 'vitest';
import {
  tokenize,
  tokenizeWords,
  isWordChar,
  snapToWordBoundaries,
  splitSentences,
  countWords,
  countTypedWords,
  clozeTokens,
  clozeTokenSeparator,
  resolveClozeTokens,
  makeWordSegmentation,
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

// Only the languages that shipped BEFORE the script-agnostic engine belong
// here: the oracle regex above is Latin-range-only, so byte-parity with it is
// the contract for exactly those packs. Languages added after #289 get their
// own goldens below instead — ru, grc, uk, zh and ja because the oracle can't
// see their scripts (zh and ja doubly so: they have no whitespace, so the oracle
// returns the whole paragraph), and tr because the oracle applies the Afrikaans 'n
// alternative to every language, which mis-splits a Turkish suffixed proper
// noun (Ankara'nın → Ankara + 'n + ın). The engine scopes 'n to the af pack.
const CORPUS: Record<Exclude<LanguageCode, 'ru' | 'grc' | 'tr' | 'uk' | 'zh' | 'ja'>, string[]> = {
  af: [
    'Hallo, hoe gaan dit met jou?',
    '’n Man loop in die straat. Sy sê: „Dit is ’n mooi dag!“',
    "ek's nie seker nie, dis 'n groot e-pos vir my pa-hulle.",
    'Woorde soos sê, môre, lêer en reën het kappies.',
    'Die boek is in 1999 geskryf — hoofstuk 3 is die beste.',
    'Ons gaan na die Klein-Karoo toe.',
  ],
  cs: [
    'Ahoj! Jak se máš?',
    // Every Czech diacritic letter sits inside the legacy À-Ö/Ø-ö/ø-ž ranges:
    // the acutes are Latin-1, and the háček letters plus ů land in Latin
    // Extended-A below U+017E. So cs must tokenize byte-identically with the
    // old pattern too — the same reason pl and eo belong here.
    'Příliš žluťoučký kůň úpěl ďábelské ódy.',
    'Koupil jsem knihu za padesát korun — byla skvělá!',
    '„Jsi si jistý?“ zeptal se dědeček v roce 1999.',
    'Je to česko-slovenský slovník a modro-bílá vlajka.',
  ],
  de: [
    'Hallo, wie geht es Ihnen?',
    'Die Häuser wurden 1999 gebaut, z.B. das E-Mail-Haus am Süd-West-Ufer.',
    '„Sind Sie sicher?“, fragte er. Über größere Straßen fußt man nicht.',
    'Das Mädchen aß süße Äpfel — und zwar viele!',
  ],
  eo: [
    'Saluton, kiel vi fartas?',
    // All six supersignoj (U+0108–U+016D) sit inside the legacy ø–ž range,
    // so eo must tokenize byte-identically with the old pattern too.
    'Eĥoŝanĝo ĉiuĵaŭde: la ses supersignoj ĉ, ĝ, ĥ, ĵ, ŝ kaj ŭ.',
    'La ĝardeno estas bela, ĉu ne? Ŝi aĉetis ĉokoladon kaj ĵurnalon.',
    'Mi loĝas en malgranda urbo ekde 1999 — ĝi estas tre trankvila.',
    "De l' mondo venis aŭdaca knabo.",
    'Hodiaŭ estas belega tago, ankaŭ morgaŭ estos.',
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
  it: [
    'Ciao! Come stai?',
    "L'acqua è fresca e un'amica beve il caffè.",
    "Dov'è l'università? È nell'edificio più antico.",
  ],
  nl: [
    'Hallo, hoe gaat het met je?',
    "'t Is zo'n mooie dag, foto's van m'n huis.",
    "Hij zei: 'De brontosaurussen aten 's ochtends.'",
  ],
  pl: [
    'Cześć! Jak się masz?',
    // All nine diacritic letters (ą ć ę ł ń ó ś ź ż) sit inside the legacy
    // À-Ö/Ø-ö/ø-ž ranges, so pl must tokenize byte-identically with the old
    // pattern too — the same reason eo belongs here rather than in its own
    // goldens.
    'Żółw i gęś zjadły pączki: ćwierć, źródło, święto, książę.',
    'Kupiłem książkę za pięćdziesiąt złotych — była świetna!',
    '„Czy jesteś pewien?” — zapytał dziadek w 1999 roku.',
    'To biało-czerwona flaga i polsko-angielski słownik.',
    "Czytałem powieść Joyce'a i wiersz Kennedy'ego.",
  ],
  pt: [
    'Olá! Tudo bem?',
    'A menina comprou pães, açúcar e café na padaria.',
    'Ele não recebeu as informações corretas — que confusão!',
    'Compramos um guarda-chuva na segunda-feira, por volta das 3 horas.',
    '“Você viu a canção número 42?”, perguntou o avô.',
  ],
};

describe('tokenize — byte-identical with the legacy reader for shipped languages', () => {
  for (const [code, texts] of Object.entries(CORPUS) as [
    Exclude<LanguageCode, 'ru' | 'grc' | 'tr' | 'uk' | 'zh' | 'ja'>,
    string[],
  ][]) {
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

  it("scopes the 'n article to the packs that have it (de splits it)", () => {
    // Deliberate per-pack behavior: German has no 'n article, so de tokenizes
    // the apostrophe as a boundary. This is why the READER must tokenize by
    // the lesson's language, not the active UI language (MarkdownReader) —
    // af content viewed under an active de client split its 'n before that.
    expect(tokenizeWords("dit is 'n dag", LANGUAGES.de).map((t) => t.text)).toEqual([
      'dit',
      'is',
      'n',
      'dag',
    ]);
    expect(tokenizeWords("dit is 'n dag", LANGUAGES.af).map((t) => t.text)).toEqual([
      'dit',
      'is',
      "'n",
      'dag',
    ]);
  });

  it('joins true-hyphen codepoints U+2010/U+2011 like ASCII hyphens (upgrade over legacy)', () => {
    // Legacy split these; real hyphen codepoints inside compounds are the
    // same word, so the engine now keeps them whole (#289).
    const de = LANGUAGES.de;
    const withNbHyphen = 'E' + String.fromCharCode(0x2011) + 'Mail';
    expect(tokenizeWords(withNbHyphen, de).map((t) => t.text)).toEqual([withNbHyphen]);
  });

  it('splits Italian elisions into clitic and content tokens', () => {
    expect(tokenizeWords("L'acqua e un'amica", LANGUAGES.it).map((token) => token.text)).toEqual([
      'L',
      'acqua',
      'e',
      'un',
      'amica',
    ]);
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

// ru (#212) and grc (#254) graduated from synthetic packs to real registry
// entries — these goldens now run against the shipped manifests, proving the
// engine needs no per-script code for them.
const ru = LANGUAGES.ru;
const grc = LANGUAGES.grc;
const ar = synth({ bcp47: 'ar', direction: 'rtl', hasCase: false, sentenceTerminators: '؟.!' });
const hbo = synth({ bcp47: 'he', direction: 'rtl', hasCase: false });
const ko = synth({ bcp47: 'ko', kind: 'hangul', hasCase: false });
const zh = synth({
  bcp47: 'zh-Hans',
  kind: 'cjk-unspaced',
  hasCase: false,
  sentenceTerminators: '。．！？!?',
});
// The second `cjk-unspaced` language (#214), and a real pack now rather than a
// synthetic one. It pins that the engine is script-class generic: the only
// difference from zh is the bcp47 tag handed to Intl.Segmenter.
const ja = LANGUAGES.ja;

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

  it('segments unspaced Chinese into words, not one letter run', () => {
    expect(tokenizeWords('我喜欢读书。', zh).map((t) => t.text)).toEqual(['我', '喜欢', '读书']);
  });
});

// ---------------------------------------------------------------------------
// Unspaced-CJK engine (#289 Phase 4, item 4.1)
// ---------------------------------------------------------------------------

const ZH_CORPUS = [
  '我喜欢读书，因为读书使我快乐。',
  '他昨天去了北京大学。',
  '「你好。」她说。',
  '2026年的中国有14亿人口！',
  '他说 hello 然后走了。',
];

describe('unspaced CJK engine (#289 Phase 4)', () => {
  it('reassembles Chinese text byte-for-byte with correct offsets', () => {
    for (const text of ZH_CORPUS) {
      const tokens = tokenize(text, zh);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const t of tokens) {
        expect(text.slice(t.start, t.end)).toBe(t.text);
      }
    }
  });

  it('emits one gap token between two words, like the regex engine', () => {
    const tokens = tokenize('他说，我走。', zh);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i - 1].isWord || tokens[i].isWord).toBe(true);
    }
  });

  it('keeps multi-character words whole and splits compounds', () => {
    expect(tokenizeWords('他昨天去了北京大学。', zh).map((t) => t.text)).toEqual([
      '他',
      '昨天',
      '去了',
      '北京',
      '大学',
    ]);
  });

  it('tokenizes Latin and digits embedded in Chinese', () => {
    expect(tokenizeWords('他说 hello 然后走了。', zh).map((t) => t.text)).toEqual([
      '他',
      '说',
      'hello',
      '然后',
      // ICU keeps verb + aspect particle together (走了, and 去了 above). A
      // quality segmenter splits them; the seam swaps without touching callers.
      '走了',
    ]);
    expect(tokenizeWords('2026年的中国', zh).map((t) => t.text)).toEqual([
      '2026',
      '年',
      '的',
      '中国',
    ]);
  });

  it('splits sentences with no whitespace after the terminator', () => {
    expect(splitSentences('我喜欢读书。他昨天去了北京！你呢？', zh)).toEqual([
      '我喜欢读书。',
      '他昨天去了北京！',
      '你呢？',
    ]);
  });

  it('keeps a closing quote with the sentence it ends', () => {
    expect(splitSentences('「你好。」她说。', zh)).toEqual(['「你好。」', '她说。']);
  });

  it('collapses a run of terminators into one break', () => {
    expect(splitSentences('真的！？我不信。', zh)).toEqual(['真的！？', '我不信。']);
  });

  it('snaps a selection to segmenter boundaries, not to the whole run', () => {
    const text = '他昨天去了北京大学';
    // A caret inside 昨天 expands to 昨天 alone — the character walk the spaced
    // engine uses would swallow the entire unspaced run.
    expect(snapToWordBoundaries(text, 2, 2, zh)).toEqual({ start: 1, end: 3 });
    // A drag across two words expands to cover both whole.
    expect(snapToWordBoundaries(text, 2, 6, zh)).toEqual({ start: 1, end: 7 });
  });

  it('leaves an empty string alone', () => {
    expect(tokenize('', zh)).toEqual([]);
    expect(splitSentences('', zh)).toEqual(['']);
  });
});

// ---------------------------------------------------------------------------
// Russian pack goldens (#212) — the first shipped non-Latin language
// ---------------------------------------------------------------------------

const RU_CORPUS = [
  'Привет! Как дела?',
  'Девочка купила хлеб, молоко и ещё что-то в магазине.',
  '«Вы видели песню номер 42?» — спросил дедушка.',
  'Он объяснил, что съезд начнётся в 1999 году.',
];

describe('Russian pack (real manifest)', () => {
  it('reassembles Russian text byte-for-byte with correct offsets', () => {
    for (const text of RU_CORPUS) {
      const tokens = tokenize(text, ru);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const t of tokens) {
        expect(text.slice(t.start, t.end)).toBe(t.text);
      }
    }
  });

  it('tokenizes ё, й, ъ and hyphenated indefinites as single words', () => {
    expect(tokenizeWords('Ещё объём, чей-то музей когда-нибудь.', ru).map((t) => t.text)).toEqual([
      'Ещё',
      'объём',
      'чей-то',
      'музей',
      'когда-нибудь',
    ]);
  });

  it('treats the em dash as a boundary (Russian zero-copula punctuation)', () => {
    expect(tokenizeWords('Москва — столица России.', ru).map((t) => t.text)).toEqual([
      'Москва',
      'столица',
      'России',
    ]);
  });

  it('folds case including Ё → ё', () => {
    expect(foldWord('Ёжик', ru)).toBe('ёжик');
    expect(foldWord('МОСКВА', ru)).toBe('москва');
  });

  it('keeps a combining acute (dictionary stress mark) inside the word', () => {
    // kaikki headwords carry lexical stress as U+0301; \p{M} keeps it a word char.
    const stressed = 'молоко́';
    expect(tokenizeWords(stressed, ru).map((t) => t.text)).toEqual([stressed]);
  });

  it('snaps a mid-word selection to Cyrillic word boundaries', () => {
    const text = 'Девочка читает книгу';
    //                     ^10..12^ inside "читает" (8..14)
    expect(snapToWordBoundaries(text, 10, 12, ru)).toEqual({ start: 8, end: 14 });
  });
});

// ---------------------------------------------------------------------------
// Koine Greek pack goldens (#254) — polytonic, real manifest
// ---------------------------------------------------------------------------

const GRC_CORPUS = [
  'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν.',
  'σὺ εἶ ὁ βασιλεὺς τῶν Ἰουδαίων;',
  'ἐγώ εἰμι ἡ ὁδὸς καὶ ἡ ἀλήθεια καὶ ἡ ζωή· οὐδεὶς ἔρχεται πρὸς τὸν πατέρα εἰ μὴ δι’ ἐμοῦ.',
];

describe('Koine Greek pack (real manifest)', () => {
  it('reassembles polytonic text byte-for-byte with correct offsets', () => {
    for (const text of GRC_CORPUS) {
      const tokens = tokenize(text, grc);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const t of tokens) {
        expect(text.slice(t.start, t.end)).toBe(t.text);
      }
    }
  });

  it('keeps breathings, accents and iota subscripts inside word tokens', () => {
    expect(tokenizeWords('τῷ ᾅδῃ ᾠδὴν ᾄδουσιν', grc).map((t) => t.text)).toEqual([
      'τῷ',
      'ᾅδῃ',
      'ᾠδὴν',
      'ᾄδουσιν',
    ]);
  });

  it('splits elisions at the apostrophe like fr/it (δι’ ἐμοῦ → δι + ἐμοῦ)', () => {
    expect(tokenizeWords('δι’ ἐμοῦ καὶ κατ’ αὐτόν', grc).map((t) => t.text)).toEqual([
      'δι',
      'ἐμοῦ',
      'καὶ',
      'κατ',
      'αὐτόν',
    ]);
    // The koronis-shaped U+1FBD apostrophe (κατ᾽) is a symbol, not a word
    // char — it splits the same way.
    expect(tokenizeWords('κατ᾽ αὐτόν', grc).map((t) => t.text)).toEqual(['κατ', 'αὐτόν']);
  });

  it('folds case while preserving the final sigma', () => {
    expect(foldWord('Λόγος', grc)).toBe('λόγος');
    expect(foldWord('ΘΕΌΣ', grc)).toBe('θεός');
  });

  it('folds the oxia/tonos duplicate codepoints together at ingress (NFC)', () => {
    // Unicode encodes \u03AC twice; editions and Wiktionary mix them. NFC maps
    // the Greek Extended oxia form to the tonos singleton.
    const oxia = '\u1F00\u03B3\u1F71\u03C0\u03B7'; // \u1F00\u03B3 + ALPHA WITH OXIA + \u03C0\u03B7
    const tonos = '\u1F00\u03B3\u03AC\u03C0\u03B7'; // same word with ALPHA WITH TONOS
    expect(oxia).not.toBe(tonos);
    expect(normalizeText(oxia)).toBe(tonos);
    expect(foldWord(oxia, grc)).toBe(foldWord(tonos, grc));
  });

  it('splits sentences on the erotimatiko and ano teleia', () => {
    expect(splitSentences('τί ἐστιν ἀλήθεια; ἐγώ εἰμι ἡ ὁδός· ἀμήν.', grc)).toEqual([
      'τί ἐστιν ἀλήθεια;',
      'ἐγώ εἰμι ἡ ὁδός·',
      'ἀμήν.',
    ]);
  });

  it('snaps a mid-word selection to polytonic word boundaries', () => {
    const text = 'ὁ λόγος ἦν';
    //                ^3..5^ inside "λόγος" (2..7)
    expect(snapToWordBoundaries(text, 3, 5, grc)).toEqual({ start: 2, end: 7 });
  });
});

// ---------------------------------------------------------------------------
// Turkish pack goldens (#209-style Latin pack, dotted/dotless i)
// ---------------------------------------------------------------------------

const tr = LANGUAGES.tr;

const TR_CORPUS = [
  'Merhaba! Nasılsın?',
  'Çocuklar bahçede oynuyor, çünkü hava çok güzel.',
  'Kitabı 1999 yılında İstanbul’da okudum.',
  '“Numara 42 şarkısını duydun mu?” diye dedem sordu.',
  'Işık söndü ve oda birdenbire karanlık oldu.',
];

describe('Turkish pack (real manifest)', () => {
  it('reassembles Turkish text byte-for-byte with correct offsets', () => {
    for (const text of TR_CORPUS) {
      const tokens = tokenize(text, tr);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const t of tokens) {
        expect(text.slice(t.start, t.end)).toBe(t.text);
      }
    }
  });

  it('keeps ç ğ ı i İ ö ş ü inside word tokens', () => {
    expect(tokenizeWords('Işığı gördüğüm için çok şaşırdım.', tr).map((t) => t.text)).toEqual([
      'Işığı',
      'gördüğüm',
      'için',
      'çok',
      'şaşırdım',
    ]);
  });

  it('splits a suffixed proper noun at the apostrophe, leaving the noun whole', () => {
    // Turkish separates a case suffix from a proper noun with an apostrophe.
    // Splitting there is what makes "İstanbul" independently lookupable; the
    // stranded suffix is a stop word.
    expect(tokenizeWords("İstanbul'da ve Ankara'nın dışında", tr).map((t) => t.text)).toEqual([
      'İstanbul',
      'da',
      've',
      'Ankara',
      'nın',
      'dışında',
    ]);
    // The typographic apostrophe (U+2019), which real Turkish text prefers.
    expect(tokenizeWords('Türkiye’nin başkenti', tr).map((t) => t.text)).toEqual([
      'Türkiye',
      'nin',
      'başkenti',
    ]);
  });

  it('folds the dotted and dotless i to different keys', () => {
    expect(foldWord('İSTANBUL', tr)).toBe('istanbul');
    expect(foldWord('IŞIK', tr)).toBe('ışık');
    expect(foldWord('Işık', tr)).toBe('ışık');
    // ILIK "lukewarm" and İLİK "marrow" must not collapse onto one key.
    expect(foldWord('ILIK', tr)).not.toBe(foldWord('İLİK', tr));
  });

  it('round-trips tokenize → fold with no leftover combining dot', () => {
    const folded = tokenizeWords('İyi akşamlar! İşler nasıl?', tr).map((t) => foldWord(t.text, tr));
    expect(folded).toEqual(['iyi', 'akşamlar', 'işler', 'nasıl']);
    for (const word of folded) expect(word).not.toContain('̇');
  });

  it('snaps a mid-word selection to Turkish word boundaries', () => {
    const text = 'Çocuk kitabı okuyor';
    //                  ^7..9^ inside "kitabı" (6..12)
    expect(snapToWordBoundaries(text, 7, 9, tr)).toEqual({ start: 6, end: 12 });
  });
});

// ---------------------------------------------------------------------------
// Polish pack goldens — inside legacy parity above, so these cover the pack's
// own shapes rather than the engine
// ---------------------------------------------------------------------------

const pl = LANGUAGES.pl;

describe('Polish pack (real manifest)', () => {
  it('keeps ą ć ę ł ń ó ś ź ż inside word tokens', () => {
    expect(tokenizeWords('Żółw zjadł pączek, gęś ćwiczy.', pl).map((t) => t.text)).toEqual([
      'Żółw',
      'zjadł',
      'pączek',
      'gęś',
      'ćwiczy',
    ]);
  });

  it('splits a foreign stem from its Polish case ending at the apostrophe', () => {
    // Polish attaches a case ending to a foreign name with an apostrophe.
    // Splitting there is what makes "Joyce" independently lookupable; the
    // stranded ending is a fragment, exactly as for tr — and the opposite of
    // uk, where the apostrophe is a letter of the word.
    expect(tokenizeWords("powieść Joyce'a i wiersz Kennedy'ego", pl).map((t) => t.text)).toEqual([
      'powieść',
      'Joyce',
      'a',
      'i',
      'wiersz',
      'Kennedy',
      'ego',
    ]);
    // The typographic apostrophe behaves the same way.
    expect(tokenizeWords('film Hitchcock’a', pl).map((t) => t.text)).toEqual([
      'film',
      'Hitchcock',
      'a',
    ]);
  });

  it('joins hyphenated compounds', () => {
    expect(
      tokenizeWords('biało-czerwona flaga, słownik polsko-angielski', pl).map((t) => t.text),
    ).toEqual(['biało-czerwona', 'flaga', 'słownik', 'polsko-angielski']);
  });

  it('folds case with the default Unicode mapping', () => {
    // Polish needs no fold locale, unlike tr — every letter lowercases the way
    // the default rules say, so keys stay byte-stable with plain lowercasing.
    expect(foldWord('KSIĄŻKA', pl)).toBe('książka');
    expect(foldWord('Żółw', pl)).toBe('żółw');
    expect(foldWord('ŁÓDŹ', pl)).toBe('łódź');
    expect(foldWord('Gęś', pl)).toBe('gęś');
    // The digraphs are letter sequences, not codepoints — nothing to fold.
    expect(foldWord('SZCZĘŚCIE', pl)).toBe('szczęście');
  });

  it('snaps a mid-word selection to Polish word boundaries', () => {
    const text = 'Mam nową książkę';
    //                     ^9..12^ inside "książkę" (9..16)
    expect(snapToWordBoundaries(text, 10, 12, pl)).toEqual({ start: 9, end: 16 });
  });
});

// ---------------------------------------------------------------------------
// Czech pack goldens — inside legacy parity above, so these cover the pack's
// own shapes rather than the engine
// ---------------------------------------------------------------------------

const cs = LANGUAGES.cs;

describe('Czech pack (real manifest)', () => {
  it('keeps the háček, acute and kroužek letters inside word tokens', () => {
    expect(tokenizeWords('Příliš žluťoučký kůň úpěl ďábelské ódy.', cs).map((t) => t.text)).toEqual(
      ['Příliš', 'žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy'],
    );
  });

  it('treats ch as two codepoints, not a single letter', () => {
    // ch is one letter for Czech collation. It is still two codepoints in text,
    // so the tokenizer needs no rule for it — this pins that nothing tries.
    expect(tokenizeWords('chléb a chuť', cs).map((t) => t.text)).toEqual(['chléb', 'a', 'chuť']);
  });

  it('splits at the apostrophe, like pl and unlike uk', () => {
    // Czech writes the apostrophe only for dialectal elision, never inside a
    // citation form, so it is a boundary. Splitting leaves the lookupable stem
    // on its own.
    expect(tokenizeWords("řek' mi to", cs).map((t) => t.text)).toEqual(['řek', 'mi', 'to']);
    // The typographic apostrophe behaves the same way.
    expect(tokenizeWords('film Hitchcock’a', cs).map((t) => t.text)).toEqual([
      'film',
      'Hitchcock',
      'a',
    ]);
  });

  it('joins hyphenated compounds', () => {
    expect(
      tokenizeWords('česko-slovenský slovník, modro-bílá vlajka', cs).map((t) => t.text),
    ).toEqual(['česko-slovenský', 'slovník', 'modro-bílá', 'vlajka']);
  });

  it('folds case with the default Unicode mapping', () => {
    // Czech needs no fold locale, unlike tr — every letter lowercases the way
    // the default rules say, so keys stay byte-stable with plain lowercasing.
    expect(foldWord('KNIHA', cs)).toBe('kniha');
    expect(foldWord('Žluťoučký', cs)).toBe('žluťoučký');
    expect(foldWord('KŮŇ', cs)).toBe('kůň');
    expect(foldWord('Příliš', cs)).toBe('příliš');
    // Vowel length is contrastive, so the acute must survive folding: byt (a
    // flat) and být (to be) are different words.
    expect(foldWord('BÝT', cs)).toBe('být');
    expect(foldWord('BYT', cs)).toBe('byt');
  });

  it('snaps a mid-word selection to Czech word boundaries', () => {
    const text = 'Mám novou knihu';
    //                       ^10..12^ inside "knihu" (10..15)
    expect(snapToWordBoundaries(text, 11, 13, cs)).toEqual({ start: 10, end: 15 });
  });
});

// ---------------------------------------------------------------------------
// Ukrainian pack goldens — the apostrophe is a letter, not a boundary
// ---------------------------------------------------------------------------

const uk = LANGUAGES.uk;

const UK_CORPUS = [
  'Привіт! Як справи?',
  "Я з'їв п'ять яблук, бо м'ясо закінчилося.",
  'Її ім’я — Олена, і вона живе в Києві.',
  '«Ти читав книгу номер 42?» — запитав дід.',
  'Ґудзик на його сорочці зник у 1999 році.',
];

describe('Ukrainian pack (real manifest)', () => {
  it('reassembles Ukrainian text byte-for-byte with correct offsets', () => {
    for (const text of UK_CORPUS) {
      const tokens = tokenize(text, uk);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const t of tokens) {
        expect(text.slice(t.start, t.end)).toBe(t.text);
      }
    }
  });

  it('keeps ґ є і ї inside word tokens', () => {
    // The four letters Russian does not have. No per-script code covers them —
    // they are \p{L} like the rest of Cyrillic.
    expect(tokenizeWords('Ґудзик, їжак, єдиний, інший.', uk).map((t) => t.text)).toEqual([
      'Ґудзик',
      'їжак',
      'єдиний',
      'інший',
    ]);
  });

  it('keeps an apostrophe word whole, in every variant spelling', () => {
    // The user-reported bug: the apostrophe is part of the word, so п'ять must
    // be one token. Splitting it produced п + ять, and neither half is a word.
    for (const apostrophe of ["'", '’', 'ʼ']) {
      const text = `Я з${apostrophe}їв п${apostrophe}ять яблук`;
      expect(tokenizeWords(text, uk).map((t) => t.text)).toEqual([
        'Я',
        `з${apostrophe}їв`,
        `п${apostrophe}ять`,
        'яблук',
      ]);
    }
  });

  it('folds every apostrophe variant onto one dictionary key', () => {
    // kaikki writes the headwords with ASCII '. A curly or U+02BC spelling from
    // the source text must key to the same entry, or the lookup misses.
    expect(foldWord('п’ять', uk)).toBe("п'ять");
    expect(foldWord('Пʼять', uk)).toBe("п'ять");
    expect(foldWord("П'ЯТЬ", uk)).toBe("п'ять");
    expect(foldWord("зв'язку", uk)).toBe("зв'язку");
  });

  it('leaves an apostrophe used as a quote outside the token', () => {
    // A joiner only counts between two letter runs, which is what keeps this
    // from swallowing quote marks the way a plain word character would.
    expect(tokenizeWords("'книга'", uk).map((t) => t.text)).toEqual(['книга']);
    expect(tokenizeWords('«Так» — сказав він.', uk).map((t) => t.text)).toEqual([
      'Так',
      'сказав',
      'він',
    ]);
  });

  it('still joins hyphenated compounds', () => {
    expect(tokenizeWords('будь-який день, все-таки', uk).map((t) => t.text)).toEqual([
      'будь-який',
      'день',
      'все-таки',
    ]);
  });

  it('splits the same apostrophe for packs that call it an elision (ru, fr)', () => {
    // Deliberate per-pack behavior, the mirror of the af 'n case: only uk
    // declares the apostrophe a joiner.
    expect(tokenizeWords("з'їв", LANGUAGES.ru).map((t) => t.text)).toEqual(['з', 'їв']);
    expect(tokenizeWords("l'eau", LANGUAGES.fr).map((t) => t.text)).toEqual(['l', 'eau']);
  });

  it('snaps a mid-word selection across the apostrophe', () => {
    const text = "Він з'їв яблуко";
    //                ^5..7^ inside "з'їв" (4..8)
    expect(snapToWordBoundaries(text, 5, 7, uk)).toEqual({ start: 4, end: 8 });
  });
});

// ---------------------------------------------------------------------------
// Sentence splitting (0.6)
// ---------------------------------------------------------------------------

describe('splitSentences', () => {
  it('matches the legacy reader split for default terminators', () => {
    const text = 'Die kat slaap. Die hond blaf! Waar is hulle? Hier.';
    expect(splitSentences(text, LANGUAGES.af)).toEqual(text.split(/(?<=[.!?])\s+/));
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

  it('counts segmenter tokens for unspaced CJK, not whitespace runs (#289 4.6)', () => {
    // The whole point: the whitespace count of this lesson is 1.
    expect('我喜欢读书，因为读书使我快乐。'.split(/\s+/).length).toBe(1);
    expect(countWords('我喜欢读书，因为读书使我快乐。', zh)).toBe(8);
  });

  it('strips markdown syntax before counting CJK tokens', () => {
    expect(countWords('# 标题\n\n他*昨天*去了[北京](x)。', zh)).toBe(
      countWords('标题 他昨天去了北京x。', zh),
    );
  });

  it('falls back to the spaced count for a CJK text with no pack', () => {
    expect(countWords('我喜欢读书。')).toBe(1);
  });
});

describe('countTypedWords', () => {
  it('keeps the exact historical journal count for spaced scripts', () => {
    for (const text of ['een twee drie', '  padded  ', '', '*', '(a) b', 'a\nb\tc']) {
      expect(countTypedWords(text, LANGUAGES.nl)).toBe(
        text.trim().split(/\s+/).filter(Boolean).length,
      );
    }
  });

  it('does not strip markdown, unlike countWords', () => {
    // The journal count is metered against a monthly allowance, so the lesson
    // counter's markdown stripping must not be able to move the charge.
    expect(countTypedWords('*', LANGUAGES.nl)).toBe(1);
    expect(countWords('*', LANGUAGES.nl)).toBe(0);
  });

  it('counts segmenter tokens for unspaced CJK', () => {
    expect(countTypedWords('我喜欢读书，因为读书使我快乐。', zh)).toBe(8);
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

// ---------------------------------------------------------------------------
// Cloze display tokens (#289 4.3)
// ---------------------------------------------------------------------------

describe('clozeTokens', () => {
  // THE migration guarantee. `clozeIndex` is stored in every user's
  // clozeSentences table as a whitespace-token index, so a spaced pack must
  // keep splitting on whitespace forever. Re-deriving through the tokenizer
  // would move every index past an apostrophe or a hyphen.
  it.each([
    ['fr', "L'eau est belle."],
    ['fr', "Aujourd'hui j'ai vu l'homme."],
    ['af', "Dit is 'n groot hond."],
    ['uk', "П'ять котів сплять."],
    ['grc', 'ἐν ἀρχῇ ἦν ὁ λόγος.'],
    ['ru', 'Привет, как дела?'],
    ['tr', 'İyi günler dostum.'],
  ] as Array<[LanguageCode, string]>)(
    'keeps the whitespace split for %s so stored indices cannot move',
    (code, sentence) => {
      expect(clozeTokens(sentence, LANGUAGES[code])).toEqual(sentence.split(/\s+/));
    },
  );

  it('proves the apostrophe case would break under the tokenizer', () => {
    // Not a behaviour assertion — a guard on the reason the rule exists. If
    // these two ever agree, the comment above is stale, not the code.
    const sentence = "L'eau est belle.";
    expect(clozeTokens(sentence, LANGUAGES.fr)).toHaveLength(3);
    expect(tokenizeWords(sentence, LANGUAGES.fr)).toHaveLength(4);
  });

  it('falls back to the whitespace split with no pack', () => {
    expect(clozeTokens('Die hond is groot.', undefined)).toEqual(['Die', 'hond', 'is', 'groot.']);
  });

  it('segments unspaced CJK, which has no whitespace to split on', () => {
    expect(clozeTokens('我喜欢读书。', zh)).toEqual(['我', '喜欢', '读书', '。']);
  });

  it('segments Japanese through the same generic engine', () => {
    // The engine dispatches on script.kind and passes script.bcp47 straight to
    // Intl.Segmenter, so ja needs no code of its own (#214 rides on this).
    expect(clozeTokens('私は日本語を勉強しています。', ja)).toEqual([
      '私',
      'は',
      '日本語',
      'を',
      '勉強',
      'し',
      'てい',
      'ます',
      '。',
    ]);
  });

  it.each([
    ['fr', "L'eau est belle.", LANGUAGES.fr],
    ['af', 'Die hond is groot.', LANGUAGES.af],
    ['zh', '我喜欢读书。', zh],
    ['ja', '私は日本語を勉強しています。', ja],
  ] as Array<[string, string, LanguageConfig]>)(
    'round-trips %s: tokens rejoin to the exact sentence',
    (_label, sentence, pack) => {
      const tokens = clozeTokens(sentence, pack);
      expect(tokens.join(clozeTokenSeparator(sentence, tokens, pack))).toBe(sentence);
    },
  );
});

describe('clozeTokenSeparator', () => {
  it('infers the empty separator for an unspaced sentence', () => {
    expect(clozeTokenSeparator('我喜欢读书。', ['我', '喜欢', '读书', '。'])).toBe('');
  });

  it('infers a space for a spaced sentence', () => {
    expect(clozeTokenSeparator('Die hond is groot.', ['Die', 'hond', 'is', 'groot.'])).toBe(' ');
  });

  it('needs no pack to tell the two apart', () => {
    // The practice reducer has no pack in hand; this is why inference beats a
    // pack lookup there.
    expect(clozeTokenSeparator('私は本を読む。', ['私', 'は', '本', 'を', '読む', '。'])).toBe('');
  });

  it('falls back to the pack when the tokens no longer rebuild the sentence', () => {
    // The blanked sentence has an edited token, so neither join matches.
    expect(clozeTokenSeparator('我喜欢读书。', ['我', '_____', '读书', '。'], zh)).toBe('');
    expect(clozeTokenSeparator('Die hond is groot.', ['Die', '_____'], LANGUAGES.af)).toBe(' ');
  });

  it('falls back to a space for a single-token array with no pack', () => {
    expect(clozeTokenSeparator('Hallo', ['Hallo'])).toBe(' ');
  });
});

describe('resolveClozeTokens', () => {
  it('prefers the stored array over any derivation', () => {
    // A bank that segmented 喜欢读书 as one word stays authoritative, so the
    // index the builder wrote keeps pointing at the same token.
    expect(resolveClozeTokens('我喜欢读书。', ['我', '喜欢读书', '。'], zh)).toEqual([
      '我',
      '喜欢读书',
      '。',
    ]);
  });

  it('derives when the row stores nothing', () => {
    expect(resolveClozeTokens('Die hond is groot.', null, LANGUAGES.af)).toEqual([
      'Die',
      'hond',
      'is',
      'groot.',
    ]);
  });

  it('treats an empty stored array as absent', () => {
    expect(resolveClozeTokens('Die hond.', [], LANGUAGES.af)).toEqual(['Die', 'hond.']);
  });
});

// ---------------------------------------------------------------------------
// Word-list segmentation (#289 4.2)
// ---------------------------------------------------------------------------

describe('makeWordSegmentation', () => {
  it('returns null for an absent or empty list, so callers get one falsy check', () => {
    expect(makeWordSegmentation(null)).toBeNull();
    expect(makeWordSegmentation(undefined)).toBeNull();
    expect(makeWordSegmentation([])).toBeNull();
    expect(makeWordSegmentation([''])).toBeNull();
  });

  it('reports the longest entry, which bounds the match window', () => {
    const seg = makeWordSegmentation(['我', '喜欢', '读书'])!;
    expect(seg.maxLength).toBe(2);
    expect(seg.size).toBe(3);
    expect(seg.has('喜欢')).toBe(true);
    expect(seg.has('喜')).toBe(false);
  });

  it('de-duplicates repeated forms', () => {
    expect(makeWordSegmentation(['我', '我', '喜欢'])!.size).toBe(2);
  });
});

describe('tokenize with a word list', () => {
  it('prefers the list over Intl.Segmenter, so a server segmenter wins', () => {
    // ICU splits 读书 as one word; this list deliberately says otherwise, which
    // is how a jieba/MeCab result overrides the browser's opinion.
    const seg = makeWordSegmentation(['我', '喜欢读书'])!;
    expect(tokenizeWords('我喜欢读书。', zh, seg).map((t) => t.text)).toEqual(['我', '喜欢读书']);
    expect(tokenizeWords('我喜欢读书。', zh).map((t) => t.text)).toEqual(['我', '喜欢', '读书']);
  });

  it('matches longest-first, not first-fit', () => {
    const seg = makeWordSegmentation(['日', '日本', '日本語'])!;
    expect(tokenizeWords('日本語', ja, seg).map((t) => t.text)).toEqual(['日本語']);
  });

  it('keeps an uncovered character as its own word token, so it stays tappable', () => {
    const seg = makeWordSegmentation(['喜欢'])!;
    expect(tokenizeWords('我喜欢書', zh, seg).map((t) => t.text)).toEqual(['我', '喜欢', '書']);
  });

  it('classifies uncovered punctuation as a gap and merges runs', () => {
    const seg = makeWordSegmentation(['我', '喜欢'])!;
    const tokens = tokenize('我喜欢！？', zh, seg);
    expect(tokens.map((t) => [t.text, t.isWord])).toEqual([
      ['我', true],
      ['喜欢', true],
      ['！？', false],
    ]);
  });

  it('never splits an astral character into lone surrogates', () => {
    // 𠮷 (U+20BB7) is two UTF-16 units. Splitting it would render tofu.
    const seg = makeWordSegmentation(['喜欢'])!;
    const tokens = tokenizeWords('𠮷喜欢', zh, seg);
    expect(tokens.map((t) => t.text)).toEqual(['𠮷', '喜欢']);
    expect(tokens[0].end - tokens[0].start).toBe(2);
  });

  it.each([
    ['我喜欢读书。这本书很好。', ['我', '喜欢读书', '这本书', '很好']],
    ['私は日本語を勉強します。', ['私', 'は', '日本語', 'を', '勉強']],
    ['我喜欢COVID-19的论文。', ['我', '喜欢']],
  ] as Array<[string, string[]]>)(
    'satisfies the exhaustive-stream contract for %s',
    (text, words) => {
      const seg = makeWordSegmentation(words)!;
      const tokens = tokenize(text, text.includes('私') ? ja : zh, seg);
      expect(tokens.map((t) => t.text).join('')).toBe(text);
      for (const token of tokens) {
        expect(text.slice(token.start, token.end)).toBe(token.text);
      }
      let position = 0;
      for (const token of tokens) {
        expect(token.start).toBe(position);
        position = token.end;
      }
      expect(position).toBe(text.length);
    },
  );

  it('ignores the list for spaced packs, which already have an exact answer', () => {
    // A stray list must never change a shipped Latin pack's output.
    const seg = makeWordSegmentation(['Die hond'])!;
    expect(tokenizeWords('Die hond is groot.', LANGUAGES.af, seg).map((t) => t.text)).toEqual([
      'Die',
      'hond',
      'is',
      'groot',
    ]);
  });
});

describe('snapToWordBoundaries with a word list', () => {
  it('snaps to the list boundaries the render used, not ICU boundaries', () => {
    const text = '我喜欢读书。';
    const seg = makeWordSegmentation(['我', '喜欢读书'])!;
    // Tap inside 读 — the list says it belongs to 喜欢读书, ICU would say 读书.
    const tapAt = text.indexOf('读');
    expect(snapToWordBoundaries(text, tapAt, tapAt + 1, zh, seg)).toEqual({ start: 1, end: 5 });
    expect(snapToWordBoundaries(text, tapAt, tapAt + 1, zh)).toEqual({ start: 3, end: 5 });
  });
});
