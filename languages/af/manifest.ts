const AVOID_WORDS = new Set([
  "'n",
  'die',
  'en',
  'of',
  'in',
  'op',
  'vir',
  'met',
  'na',
  'van',
  'is',
  'het',
  'om',
  'te',
  'dat',
  'wat',
  'as',
  'aan',
  'by',
  'sy',
  'hy',
  'nie',
  'ek',
  'jy',
  'ons',
  'hulle',
  'dit',
  'was',
  'sal',
  'kan',
  'moet',
  'maar',
  'ook',
  'al',
  'nog',
  'so',
  'toe',
  'nou',
  'net',
  'eers',
  'dan',
]);

export const af = {
  name: 'Afrikaans',
  native: 'Afrikaans',
  code: 'af' as const,
  flag: '\u{1F1FF}\u{1F1E6}',
  ttsCode: 'af-ZA',
  ttsVoice: 'af-ZA-Standard-A',
  tatoebaCode: 'afr',
  fallbackTts: ['af', 'nl-NL', 'nl'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'Hallo, hoe gaan dit met jou?',
  // Google is the canonical voice; browser TTS layers on client-side (#307 §3.2).
  pronunciation: { audio: ['google'] as const },
  script: {
    bcp47: 'af',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
    // The 'n indefinite article is a word of its own, apostrophe included —
    // matched ahead of the engine's letter-run pattern (any apostrophe variant,
    // since curly-quote autocorrect regularly produces ‘n/’n). The boundary
    // must be Unicode-aware, NOT \b: ASCII \b saw a word edge between N and á
    // in "‘Ná my kom…" (á isn't ASCII \w), so the opening quote + N matched as
    // the article and orphaned the "á".
    extraTokenPatterns: ["['‘’ʼ`]n(?![\\p{L}\\p{M}0-9_])"],
    // The apostrophe is part of the spelling, not a quote mark. A noun that
    // ends in a single vowel letter takes 's for the plural (foto's, video's,
    // ma's, taxi's, menu's, baby's), and g'n / s'n / ek's write an elision the
    // same way. Splitting them left a content half and a bare 's', and neither
    // half is what the reader tapped (#430). A joiner only counts between two
    // letter runs, so a quote mark at a token edge stays out.
    //
    // Dutch spells the same plural and still splits. Nothing blocks the same
    // change there. The clitic fragments in the nl avoidWords list are an
    // OUTPUT of the split and not a dependency of it, so a joiner can land
    // without a rework: Italian kept its own fragments after #548, because
    // wordfreq and older vocab rows still carry them.
    extraJoiners: "'‘’ʼʹ`´",
    // Running text carries whichever variant its editor produced — the af
    // corpus itself writes ’n with a curly quote — so fold them to ASCII ' and
    // key foto's and foto’s as one word.
    foldApostrophes: true,
  },
  // The written form carries the plural (foto's) and the dictionary keys the
  // singular (foto). Peel the 's after the exact key misses, so a tap on the
  // whole token still defines it. vocabKeys only keeps a candidate whose peeled
  // part holds an apostrophe, so this cannot fire on a plain -s plural.
  morphology: {
    clitics: ["'s"],
    maxClitics: 1,
    // 2 so ma's and pa's still peel, while 's on its own cannot.
    minStem: 2,
  },
};
