export type LanguageCode = 'af' | 'de' | 'es';

export interface LanguageConfig {
  name: string;
  native: string;
  code: LanguageCode;
  flag: string;
  ttsCode: string;
  ttsVoice: string;
  tatoebaCode: string;
  fallbackTts: string[];
  avoidWords: Set<string>;
  testPhrase: string;
}

const AF_AVOID_WORDS = new Set([
  "'n", "die", "en", "of", "in", "op", "vir", "met", "na", "van",
  "is", "het", "om", "te", "dat", "wat", "as", "aan", "by", "sy", "hy",
  "nie", "ek", "jy", "ons", "hulle", "dit", "was", "sal", "kan", "moet",
  "maar", "ook", "al", "nog", "so", "toe", "nou", "net", "eers", "dan",
]);

const DE_AVOID_WORDS = new Set([
  "der", "die", "das", "ein", "eine", "und", "oder", "in", "auf", "für",
  "mit", "nach", "von", "ist", "hat", "um", "zu", "dass", "was", "als",
  "an", "bei", "sie", "er", "nicht", "ich", "du", "wir", "ihr", "es",
  "war", "wird", "kann", "muss", "aber", "auch", "schon", "noch", "so",
  "dann", "nur", "erst", "den", "dem", "des", "im", "am", "vom", "zum",
]);

const ES_AVOID_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "y", "o", "en", "de",
  "por", "con", "para", "del", "al", "es", "ha", "ser", "que", "como",
  "a", "su", "él", "ella", "no", "yo", "tú", "nos", "ellos", "eso",
  "fue", "será", "puede", "debe", "pero", "también", "ya", "aún", "así",
  "muy", "más", "sin", "se", "me", "te", "lo", "le", "nos", "les",
]);

export const LANGUAGES: Record<LanguageCode, LanguageConfig> = {
  af: {
    name: 'Afrikaans',
    native: 'Afrikaans',
    code: 'af',
    flag: '\u{1F1FF}\u{1F1E6}',
    ttsCode: 'af-ZA',
    ttsVoice: 'af-ZA-Standard-A',
    tatoebaCode: 'afr',
    fallbackTts: ['af', 'nl-NL', 'nl'],
    avoidWords: AF_AVOID_WORDS,
    testPhrase: 'Hallo, hoe gaan dit met jou?',
  },
  de: {
    name: 'German',
    native: 'Deutsch',
    code: 'de',
    flag: '\u{1F1E9}\u{1F1EA}',
    ttsCode: 'de-DE',
    ttsVoice: 'de-DE-Standard-A',
    tatoebaCode: 'deu',
    fallbackTts: ['de', 'de-DE'],
    avoidWords: DE_AVOID_WORDS,
    testPhrase: 'Hallo, wie geht es Ihnen?',
  },
  es: {
    name: 'Spanish',
    native: 'Español',
    code: 'es',
    flag: '\u{1F1EA}\u{1F1F8}',
    ttsCode: 'es-ES',
    ttsVoice: 'es-ES-Standard-A',
    tatoebaCode: 'spa',
    fallbackTts: ['es', 'es-ES', 'es-MX'],
    avoidWords: ES_AVOID_WORDS,
    testPhrase: '\u00a1Hola! \u00bfC\u00f3mo est\u00e1s?',
  },
};

export const DEFAULT_LANGUAGE: LanguageCode = 'af';

export function getLanguageConfig(code: LanguageCode): LanguageConfig {
  return LANGUAGES[code];
}

export function isValidLanguageCode(code: string): code is LanguageCode {
  return code in LANGUAGES;
}

export function getAllLanguages(): LanguageConfig[] {
  return Object.values(LANGUAGES);
}
