const AVOID_WORDS = new Set([
  "'n", "die", "en", "of", "in", "op", "vir", "met", "na", "van",
  "is", "het", "om", "te", "dat", "wat", "as", "aan", "by", "sy", "hy",
  "nie", "ek", "jy", "ons", "hulle", "dit", "was", "sal", "kan", "moet",
  "maar", "ook", "al", "nog", "so", "toe", "nou", "net", "eers", "dan",
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
  script: {
    bcp47: 'af',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
    // The 'n indefinite article is a word of its own, apostrophe included —
    // matched ahead of the engine's letter-run pattern (any apostrophe variant).
    extraTokenPatterns: ["['‘’ʼ`]n\\b"],
  },
};
