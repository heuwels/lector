const AVOID_WORDS = new Set([
  "o", "a", "os", "as", "um", "uma", "e", "ou", "de", "do",
  "da", "dos", "das", "em", "no", "na", "nos", "nas", "ao", "à",
  "por", "para", "com", "sem", "que", "se", "como", "mas", "porque", "sobre",
  "eu", "você", "ele", "ela", "nós", "eles", "elas", "me", "te", "lhe",
  "meu", "seu", "isso", "isto", "este", "esta", "não", "já", "também", "muito",
  "mais", "só", "é", "são", "foi", "ser", "está", "tem", "há", "vai",
]);

export const pt = {
  name: 'Portuguese',
  native: 'Português',
  code: 'pt' as const,
  flag: '\u{1F1E7}\u{1F1F7}',
  ttsCode: 'pt-BR',
  // Brazilian Portuguese (pt-BR) is the default variant — the larger learner
  // audience, and both Tatoeba `por` and wordfreq `pt` are pt-BR-leaning.
  // pt-BR-Standard-A is the female Standard voice (24 kHz), matching es/de/af's
  // Standard-A tier + gender. Verified against Google's supported-voices list.
  ttsVoice: 'pt-BR-Standard-A',
  tatoebaCode: 'por',
  fallbackTts: ['pt', 'pt-BR', 'pt-PT'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'Olá! Tudo bem?',
  // Google is the canonical voice; browser TTS layers on client-side (#307 §3.2).
  pronunciation: { audio: ['google'] as const },
  script: {
    bcp47: 'pt',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
  },
};
