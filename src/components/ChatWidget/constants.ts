import { LanguageCode } from '@/types/language';

// TODO: Scope these to the active language
export const EXAMPLE_PROMPTS: Record<LanguageCode, string[]> = {
  af: [
    'What\'s the difference between "hou van" and "hou daarvan"?',
    'When do I use "het" vs "is" for past tense?',
    'How do diminutives work in Afrikaans?',
  ],
  de: [
    'How does the German case system work?',
    'When do I use "der", "die", and "das"?',
    'How do separable verbs work in German?',
  ],
  eo: [
    'How does the accusative -n ending work?',
    'Explain the correlative table (kiu, tiu, ĉiu, neniu…)',
    'How do word-building affixes like mal-, -ul-, and -ej- combine?',
  ],
  es: [
    'When do I use "ser" vs "estar"?',
    'What\'s the difference between "por" and "para"?',
    'When should I use the Spanish subjunctive?',
  ],
  fr: [
    'When do I use "tu" vs "vous"?',
    'Explain the difference between "être" and "avoir" as auxiliaries',
    "How does elision work (l', d', qu')?",
  ],
  it: [
    'When do I use "essere" vs "avere" in the passato prossimo?',
    'What\'s the difference between "sapere" and "conoscere"?',
    "How do Italian elisions work (l', un', dell')?",
  ],
  nl: [
    'When do I use "de" vs "het" as a noun\'s article?',
    'How do separable verbs work (e.g. "opbellen", "meenemen")?',
    'What\'s the difference between "kennen" and "weten"?',
  ],
  pt: [
    'When do I use "ser" vs "estar" (both mean "to be")?',
    'What\'s the difference between "por" and "para"?',
    'How does the personal infinitive work?',
  ],
};
