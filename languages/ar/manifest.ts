// Modern Standard Arabic (#253). The first right-to-left pack, and the first
// pack whose written form and dictionary form differ by default: a dictionary
// prints كَتَبَ and a newspaper prints كتب. See foldArabicKey in
// languages/text.ts for the fold that closes that gap, and the `ar` profile in
// scripts/build-dictionary.ts for the same fold applied to every key.
//
// MSA, not a spoken dialect. Wiktionary, Tatoeba and Google TTS all carry the
// written standard, which is exactly right for a reading app and is nobody's
// home dialect. The site says so.

// Cloze stop-words. EVERY ENTRY IS THE FOLDED KEY, not the printed spelling:
// foldArabicKey folds أ إ آ ٱ to bare ا, so `إلى` is stored as `الى` and both
// `أن` and `إن` collapse to `ان`. That looks like a set of misspellings and is
// not one — the cloze builder folds the frequency list the same way, so a
// printed spelling here would simply never match.
//
// Arabic has no indefinite article and writes its definite article, its
// conjunctions and its short prepositions as proclitics, so the function-word
// load that matters for a cloze is pronouns, demonstratives, relatives,
// negators and the free prepositions. Blanking any of them teaches nothing.
const AVOID_WORDS = new Set([
  // free prepositions
  'في',
  'من',
  'الى',
  'على',
  'عن',
  'مع',
  'عند',
  'بين',
  'حتى',
  'ضد',
  'نحو',
  'خلال',
  'بعد',
  'قبل',
  'فوق',
  'تحت',
  'امام',
  'خلف',
  'وراء',
  'دون',
  'بدون',
  'حول',
  'لدى',
  'منذ',
  'سوى',
  // conjunctions and subordinators
  'او',
  'ثم',
  'لكن',
  'بل',
  'ان',
  'انه',
  'انها',
  'اذا',
  'اذ',
  'لو',
  'كي',
  'لكي',
  'حيث',
  'لان',
  'بينما',
  'كما',
  'مثل',
  'اما',
  'اذن',
  // negation
  'لا',
  'ما',
  'لم',
  'لن',
  'ليس',
  'ليست',
  'غير',
  // pronouns
  'انا',
  'انت',
  'هو',
  'هي',
  'نحن',
  'انتم',
  'انتن',
  'هم',
  'هن',
  'هما',
  'نفس',
  // demonstratives and place words
  'هذا',
  'هذه',
  'ذلك',
  'تلك',
  'هؤلاء',
  'اولئك',
  'هنا',
  'هناك',
  // relatives
  'الذي',
  'التي',
  'الذين',
  'اللاتي',
  'اللواتي',
  // interrogatives
  'ماذا',
  'متى',
  'اين',
  'كيف',
  'لماذا',
  'هل',
  'اي',
  'كم',
  // quantifiers and degree
  'كل',
  'بعض',
  'جميع',
  'معظم',
  'اكثر',
  'اقل',
  'كثير',
  'قليل',
  'جدا',
  'فقط',
  'ايضا',
  // the copula and the aspect particles that carry no lexical content
  'كان',
  'كانت',
  'يكون',
  'تكون',
  'قد',
  'لقد',
  'سوف',
  'نعم',
  'ربما',
]);

export const ar = {
  name: 'Arabic',
  native: 'العربية',
  code: 'ar' as const,
  // No country flag. MSA is a pan-Arab written standard that no single state
  // owns, and a Saudi flag on "Arabic" reads as a claim to an Egyptian, Iraqi
  // or Moroccan learner. Same reasoning as the 🏛️ on la/grc: a non-flag glyph
  // whenever no country is the answer.
  flag: '\u{1F30D}',
  // Google publishes Arabic as ar-XA — a deliberately multi-region MSA voice
  // rather than one national accent, which is the right shape for this pack.
  // Standard-A is the lowest-lettered Standard voice and is female, matching
  // the tier and gender af/de/es/pt/ru/pl/tr/zh use.
  ttsCode: 'ar-XA',
  ttsVoice: 'ar-XA-Standard-A',
  tatoebaCode: 'ara',
  fallbackTts: ['ar-SA', 'ar-EG', 'ar'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'مرحبا! كيف حالك؟',
  pronunciation: { audio: ['google'] as const },
  script: {
    bcp47: 'ar',
    // The first rtl pack. ReaderArticle and TranscriptReader already read this
    // field (#289 Phase 2); every bidi-isolation site is listed in #253.
    direction: 'rtl' as const,
    // Arabic is space-separated, so the shared Unicode-property engine covers
    // it with no new character ranges. This is the whole reason #253 is
    // independent of the Mandarin segmentation spike: the `/\s+/` word model
    // holds. Combining marks are word characters already, so vocalized text
    // keeps its words whole, and the Arabic-Indic digits ٠-٩ and the Arabic
    // comma ، and semicolon ؛ are boundaries.
    kind: 'alpha-spaced' as const,
    // Arabic has no letter case, so foldWord skips lowercasing entirely.
    hasCase: false,
    // Arabic writes its own question mark, U+061F, and shares the Latin full
    // stop and exclamation mark. The comma ، and semicolon ؛ are NOT
    // terminators.
    sentenceTerminators: '.!?؟',
    // A learner types unvocalized Arabic, because that is how the language is
    // written and because tashkeel needs a specialist keyboard. Accept a
    // mark-stripped answer, the same concession polytonic Greek gets.
    //
    // The MARK SET is Arabic, not Greek. foldForComparison folds an ar answer
    // with foldArabicKey. Greek's `stripMarks` drops every \p{M} off the NFD
    // form, which rewrites ؤ to و and ئ to ي, so it grades رؤية and روية as
    // one word. See foldForComparison, and step 3-ar in dictionary-db.ts for
    // the same trap on the lookup side.
    practiceLeniency: 'fold-marks' as const,
  },
  // Arabic attaches its grammar at BOTH ends of the word with no space, and
  // kaikki enumerates neither end.
  //
  // The head takes conjunctions, short prepositions and the definite article,
  // and they stack in a fixed order: وبالقلم is و + ب + ال + قلم. The tail
  // takes the possessive and object pronouns: كتابه is كتاب + ه.
  //
  // This runs last in the lookup, after the exact key and the inflections
  // table, so a word that is a headword in its own right keeps its own entry.
  // That ordering is what makes the single-letter proclitics safe: سلام is a
  // headword, so nothing peels a س off it to reach the letter-name لام.
  morphology: {
    // Possessive and object pronoun enclitics, longest-match first at runtime.
    clitics: ['ه', 'ها', 'هم', 'هن', 'هما', 'ك', 'كم', 'كن', 'كما', 'نا', 'ني', 'ي'],
    // One. Arabic attaches at most one pronoun to a noun or a verb; a second
    // pass would only invent false stems.
    maxClitics: 1,
    prefixes: [
      // the definite article, alone and after the prepositions that fuse with
      // it. لل is ل + ال with the alef elided, which no generic peel can reach.
      'ال',
      'لل',
      // conjunctions
      'و',
      'ف',
      // prepositions
      'ب',
      'ل',
      'ك',
      // the future particle, which is written solid: سيكتب is س + يكتب
      'س',
    ],
    // Three, which is what the deepest real stack needs: و + ب + ال.
    maxPrefixes: 3,
    // Two, and this was measured. Three is the length of a bare triliteral
    // noun and looks like the safe floor, but Arabic writes its proclitics onto
    // its SHORTEST words most often: وهو, ومن, ففي, بكل, الكل. Every one of
    // those is a 3-letter token whose stem is 2 letters, so a floor of 3 left
    // 17 of the 89 coverage misses unresolved — the single largest class of
    // miss in the language. A 2-letter Arabic word is a function word, which is
    // exactly what a proclitic attaches to.
    minStem: 2,
  },
};
