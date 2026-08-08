import { LanguageCode } from '@/types/language';

// TODO: Scope these to the active language
export const EXAMPLE_PROMPTS: Record<LanguageCode, string[]> = {
  af: [
    'What\'s the difference between "hou van" and "hou daarvan"?',
    'When do I use "het" vs "is" for past tense?',
    'How do diminutives work in Afrikaans?',
  ],
  cs: [
    'How do the seven Czech cases work, and when do I use the instrumental?',
    'What is the difference between "být" and "byt"?',
    'What\'s the difference between perfective and imperfective verbs like "udělat" vs "dělat"?',
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
  grc: [
    'How does the Greek article work across cases and genders?',
    'What does the aorist tense mean compared to the imperfect?',
    'What\'s the difference between "οὐ" and "μή" for negation?',
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
  pl: [
    'How do the seven Polish cases work, and when do I use the instrumental?',
    'What is consonant alternation, as in "ręka" → "ręce"?',
    'What\'s the difference between perfective and imperfective verbs like "zrobić" vs "robić"?',
  ],
  pt: [
    'When do I use "ser" vs "estar" (both mean "to be")?',
    'What\'s the difference between "por" and "para"?',
    'How does the personal infinitive work?',
  ],
  ru: [
    'How does the Russian case system work?',
    'What\'s the difference between perfective and imperfective verbs like "сделать" vs "делать"?',
    'When do I use "идти" vs "ходить" (verbs of motion)?',
  ],
  tr: [
    'How does vowel harmony decide which suffix I use?',
    'In what order do suffixes stack on a word like "evlerimizden"?',
    'What\'s the difference between the -di and -miş past tenses?',
  ],
  uk: [
    'How does the Ukrainian case system work, including the vocative?',
    'When does a word take an apostrophe, as in "п\'ять" and "з\'їзд"?',
    'What\'s the difference between perfective and imperfective verbs like "зробити" vs "робити"?',
  ],
};
