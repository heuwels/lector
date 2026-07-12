const AVOID_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "y", "o", "en", "de",
  "por", "con", "para", "del", "al", "es", "ha", "ser", "que", "como",
  "a", "su", "él", "ella", "no", "yo", "tú", "nos", "ellos", "eso",
  "fue", "será", "puede", "debe", "pero", "también", "ya", "aún", "así",
  "muy", "más", "sin", "se", "me", "te", "lo", "le", "nos", "les",
]);

export const es = {
  name: 'Spanish',
  native: 'Español',
  code: 'es' as const,
  flag: '\u{1F1EA}\u{1F1F8}',
  ttsCode: 'es-ES',
  ttsVoice: 'es-ES-Standard-A',
  tatoebaCode: 'spa',
  fallbackTts: ['es', 'es-ES', 'es-MX'],
  avoidWords: AVOID_WORDS,
  testPhrase: '¡Hola! ¿Cómo estás?',
  script: {
    bcp47: 'es',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
  },
};
