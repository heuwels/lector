const AVOID_WORDS = new Set([
  "der", "die", "das", "ein", "eine", "und", "oder", "in", "auf", "für",
  "mit", "nach", "von", "ist", "hat", "um", "zu", "dass", "was", "als",
  "an", "bei", "sie", "er", "nicht", "ich", "du", "wir", "ihr", "es",
  "war", "wird", "kann", "muss", "aber", "auch", "schon", "noch", "so",
  "dann", "nur", "erst", "den", "dem", "des", "im", "am", "vom", "zum",
]);

export const de = {
  name: 'German',
  native: 'Deutsch',
  code: 'de' as const,
  flag: '\u{1F1E9}\u{1F1EA}',
  ttsCode: 'de-DE',
  ttsVoice: 'de-DE-Standard-A',
  tatoebaCode: 'deu',
  fallbackTts: ['de', 'de-DE'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'Hallo, wie geht es Ihnen?',
};
