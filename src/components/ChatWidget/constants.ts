import { LanguageCode } from '@/types/language';

// TODO: Scope these to the active language
export const EXAMPLE_PROMPTS: Record<LanguageCode, string[]> = {
  af: [
    'What\'s the difference between "hou van" and "hou daarvan"?',
    'When do I use "het" vs "is" for past tense?',
    'How do diminutives work in Afrikaans?',
  ],
  ar: [
    'How does the definite article ال attach, and when does its ل assimilate (الشمس vs القمر)?',
    'What is the difference between كتب and يكتب, and how do I recognise the tense?',
    'How do the verb patterns (أوزان) change the meaning of a root like ك-ت-ب?',
  ],
  bn: [
    'How do the classifiers টি, টা, খানা and জন work, and which noun takes which?',
    'What is the difference between তুমি, তুই and আপনি, and who do I use each with?',
    'How do the case endings -এ, -এর and -কে attach to a noun?',
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
  el: [
    'When do I write final ς and when do I write σ?',
    'What is the difference between δεν and μην for negation?',
    'How does the article change across cases, as in ο / τον / του?',
  ],
  fi: [
    'How do the fifteen Finnish cases work, and when do I use the partitive?',
    'What is consonant gradation, as in katu → kadun?',
    'How does vowel harmony decide which suffix I use?',
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
  hi: [
    'When do I use ने after the subject, and what does it do to the verb?',
    'What is the difference between है, हैं, था and थी?',
    'How do postpositions like का, के, की and को attach to a noun?',
  ],
  hu: [
    'What is the difference between definite látom and indefinite látok?',
    'How does vowel harmony decide which suffix I use?',
    'In what order do case, possession and number stack on a noun like házaimban?',
  ],
  id: [
    'How do the meN- / ber- / di- / ter- verb prefixes work, including nasal sandhi?',
    'When do I use "tidak" vs "bukan" for negation?',
    'How does reduplication make a plural, as in "buku-buku"?',
  ],
  it: [
    'When do I use "essere" vs "avere" in the passato prossimo?',
    'What\'s the difference between "sapere" and "conoscere"?',
    "How do Italian elisions work (l', un', dell')?",
  ],
  ja: [
    'When do I use は and when do I use が?',
    'How do the て-form and its compounds work (ている, てある, てしまう)?',
    'Why does the same kanji read one way alone and another way in a compound?',
  ],
  ko: [
    'When do I use 은/는 and when do I use 이/가?',
    'How do the speech levels work (해, 해요, 합니다)?',
    'What is the difference between 에 and 에서?',
  ],
  la: [
    'How do the five Latin noun declensions work?',
    'What is the difference between the imperfect and the perfect?',
    'When do I use the ablative versus the accusative?',
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
  sv: [
    'How does the definite suffix work, as in "hus" → "huset" → "husen"?',
    'When do I use "en" vs "ett"?',
    'What is the difference between "är" and "blir"?',
  ],
  tr: [
    'How does vowel harmony decide which suffix I use?',
    'In what order do suffixes stack on a word like "evlerimizden"?',
    "What's the difference between the -di and -miş past tenses?",
  ],
  uk: [
    'How does the Ukrainian case system work, including the vocative?',
    'When does a word take an apostrophe, as in "п\'ять" and "з\'їзд"?',
    'What\'s the difference between perfective and imperfective verbs like "зробити" vs "робити"?',
  ],
  zh: [
    'How do measure words work, and when do I use 个 vs a specific one?',
    'What is the difference between 了 as an aspect marker and as a sentence-final particle?',
    'When do I use 的, 得 and 地?',
  ],
};
