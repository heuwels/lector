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
  },
};
