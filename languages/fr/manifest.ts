const AVOID_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "l", "d",
  "et", "ou", "mais", "donc", "car", "ni", "que", "qui", "quoi", "dont",
  "à", "en", "dans", "sur", "sous", "par", "pour", "avec", "sans", "chez",
  "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ce",
  "se", "me", "te", "lui", "leur", "y", "ne", "pas", "plus", "ça",
  "est", "sont", "a", "ont", "être", "avoir", "son", "sa", "ses", "mon",
  "ma", "mes", "au", "aux", "où", "si", "comme", "très", "tout", "tous",
  // elision clitics — bare fragments left when the apostrophe splits a token
  // (l'eau → l + eau): never worth blanking.
  "c", "j", "n", "s", "t", "m", "qu",
]);

export const fr = {
  name: 'French',
  native: 'Français',
  code: 'fr' as const,
  flag: '\u{1F1EB}\u{1F1F7}',
  ttsCode: 'fr-FR',
  // fr-FR has no Standard-A (unlike es/de) — Standard-F is the female Standard
  // voice, matching es-ES-Standard-A's tier + gender. Verified against the live
  // voices API 2026-07-07.
  ttsVoice: 'fr-FR-Standard-F',
  tatoebaCode: 'fra',
  fallbackTts: ['fr', 'fr-FR', 'fr-CA'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'Bonjour ! Comment ça va ?',
  script: {
    bcp47: 'fr',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
    // No extraWordChars for the elision apostrophe: the reader deliberately
    // splits l'eau → l + eau (sentenceContainsWord matches either side, and
    // the avoidWords clitic fragments above depend on the split).
  },
};
