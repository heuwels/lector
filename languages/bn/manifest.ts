// Bengali (bn → en). The first Brahmic-script pack, and the first pack that
// ships under a REDUCED coverage gate — see `coverageThreshold` on the `bn`
// profile in scripts/build-dictionary.ts for why, and read that comment before
// judging this pack against the others.
//
// The script needed no engine work. Bengali is space-separated and
// left-to-right, so the `alpha-spaced` Unicode-property tokenizer from #289
// Phase 0 already keeps a word whole across its matras, its virama, its nuqta
// and its anusvara, and already treats the Bengali digits ০-৯ as boundaries.
// Issue #252 predicted that an Indic pack must add script ranges in four
// places. That prediction is stale: #289 replaced every per-language character
// range with \p{L}\p{M}. The one real gap was the danda, and that is a
// `sentenceTerminators` entry below.

// Cloze stop-words. Bengali writes its case, its plural and its classifiers as
// suffixes with no space, so the free function-word load that matters for a
// cloze is pronouns, postpositions, conjunctions, negators and the light verbs.
// Blanking any of them teaches nothing.
//
// Every entry is the printed spelling. Unlike ar, the bn key needs no fold —
// Bengali has no letter case and the pack sets no key fold — so `foldWord` is
// NFC alone and what is written here is what is stored.
const AVOID_WORDS = new Set([
  // pronouns
  'আমি',
  'আমরা',
  'আমার',
  'আমাদের',
  'আমাকে',
  'তুমি',
  'তোমরা',
  'তোমার',
  'তোমাদের',
  'আপনি',
  'আপনার',
  'আপনারা',
  'সে',
  'তারা',
  'তার',
  'তাদের',
  'তাকে',
  'তিনি',
  'তাঁর',
  'তাঁরা',
  'এরা',
  'ওরা',
  'নিজে',
  'নিজের',
  'নিজেকে',
  'নিজেদের',
  // demonstratives, interrogatives and relatives
  'এই',
  'ওই',
  'সেই',
  'এটা',
  'এটি',
  'ওটা',
  'সেটা',
  'সেটি',
  'এসব',
  'ওসব',
  'যে',
  'যা',
  'যিনি',
  'যারা',
  'যেটা',
  'কে',
  'কী',
  'কি',
  'কেন',
  'কোথায়',
  'কখন',
  'কীভাবে',
  'কেমন',
  'কত',
  'কার',
  // place and time adverbs that carry no lexical content
  'এখানে',
  'সেখানে',
  'যেখানে',
  'ওখানে',
  'এখন',
  'তখন',
  'যখন',
  'আজ',
  'তাই',
  'আবার',
  'এমন',
  'তেমন',
  'যেমন',
  'এভাবে',
  // postpositions. Bengali writes these as separate words, unlike the case
  // suffixes, so a cloze can and does land on one.
  'থেকে',
  'জন্য',
  'সাথে',
  'সঙ্গে',
  'দিয়ে',
  'পর',
  'আগে',
  'মধ্যে',
  'ভিতরে',
  'বাইরে',
  'উপরে',
  'ওপর',
  'নিচে',
  'কাছে',
  'দিকে',
  'পর্যন্ত',
  'ছাড়া',
  'বিরুদ্ধে',
  'মতো',
  'মত',
  'চেয়ে',
  'নিয়ে',
  'হয়ে',
  'করে',
  // conjunctions and subordinators
  'এবং',
  'ও',
  'আর',
  'কিন্তু',
  'বা',
  'অথবা',
  'যদি',
  'তবে',
  'তাহলে',
  'কারণ',
  'যেহেতু',
  'যদিও',
  'এছাড়া',
  'নাকি',
  'এদিকে',
  'এমনকি',
  // negation
  'না',
  'নি',
  'নেই',
  'নয়',
  'নাই',
  // the copula and the light verbs. করা "to do" and হওয়া "to be" carry the
  // grammar of most Bengali predicates, so their finite forms are function
  // words in practice however lexical they look in a dictionary.
  'হয়',
  'হবে',
  'হল',
  'হলো',
  'হয়েছে',
  'হচ্ছে',
  'ছিল',
  'ছিলেন',
  'আছে',
  'আছেন',
  'থাকে',
  'করা',
  'করতে',
  'করেন',
  'করেছে',
  'দিয়েছে',
  // quantifiers and degree
  'এক',
  'একটি',
  'একটা',
  'কোন',
  'কোনো',
  'অনেক',
  'বেশি',
  'কম',
  'সব',
  'সবাই',
  'সকল',
  'প্রতি',
  'আরও',
  'আরো',
  'খুব',
  'বেশ',
  'একটু',
  'কয়েক',
  'কিছু',
  'কেউ',
  'শুধু',
  'শুধুমাত্র',
  'মাত্র',
  'প্রায়',
  'অবশ্যই',
  'হয়তো',
  'মোট',
  'অন্তত',
]);

export const bn = {
  name: 'Bengali',
  native: 'বাংলা',
  code: 'bn' as const,
  // No country flag, for the same reason ar carries 🌍. Bengali is written
  // across a national border: Bangladesh has the large majority of its
  // speakers and West Bengal has the rest, and a flag on "Bengali" reads as a
  // claim to whichever side it leaves out.
  flag: '\u{1F30D}',
  // bn-IN, and this is a compromise the pack should own rather than hide.
  // Google publishes NO bn-BD voice — verified against the voices API on
  // 2026-08-31, which lists 38 bn-IN voices and zero for bn-BD — so an Indian
  // Bengali accent is the only synthesized reading available, for a language
  // whose speakers are mostly in Bangladesh. The two are mutually intelligible
  // and the written standard is shared, so the reading is correct even where
  // the accent is not local. Say so on the site rather than let a learner in
  // Dhaka discover it.
  ttsCode: 'bn-IN',
  // Standard-A is the lowest-lettered Standard voice and is female, matching
  // the tier and gender af/ar/de/es/pt/ru/pl/tr/zh use.
  ttsVoice: 'bn-IN-Standard-A',
  tatoebaCode: 'ben',
  fallbackTts: ['bn-IN', 'bn-BD', 'bn'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'নমস্কার! আপনি কেমন আছেন?',
  pronunciation: { audio: ['google'] as const },
  script: {
    bcp47: 'bn',
    direction: 'ltr' as const,
    // Space-separated, so the shared Unicode-property engine covers it with no
    // new character ranges. Verified against the tokenizer: আমি বাংলায় বই পড়ি।
    // gives four word tokens with the matras and the ya-phala intact, and
    // ২০২৪ সালে drops the Bengali digits as a boundary.
    kind: 'alpha-spaced' as const,
    // Bengali has no letter case, so foldWord skips lowercasing entirely.
    hasCase: false,
    // The danda । U+0964 is the Bengali full stop, and the double danda ॥
    // U+0965 ends a verse. Neither is in the default '.!?' set, so without
    // this every Bengali paragraph is one sentence. The Latin full stop stays
    // in the set because modern Bengali prose mixes the two.
    sentenceTerminators: '।॥.!?',
    // Left at the default 'exact'. Bengali writing does vary — ন against ণ,
    // শ against ষ, and ি against ী — but those are SPELLING variants of
    // different letters, not diacritics a keyboard cannot reach, and folding
    // them would grade a misspelling as correct. That is the trap ar hit from
    // the other direction (#253), where inheriting the Greek mark set merged
    // two real words. A bn leniency rule needs its own measurement first.
  },
  // Bengali attaches its case, its number and its classifiers to the end of the
  // noun with no space, and kaikki enumerates only part of that.
  //
  // The dump's inflection tables are genuinely rich — 38,697 distinct forms
  // over 9,929 headwords — but they stop at the paradigm and real text stacks
  // beyond it: বইগুলোর is বই + গুলো + র, and বন্ধুদেরকে is বন্ধু + দের + কে.
  //
  // Measured against the top 5,000 wordfreq-bn tokens: the exact key answers
  // 55.8% with the inflection tables included, and this slice takes it to
  // 69.7%. There are no prefixes — Bengali builds at the tail, not the head.
  morphology: {
    // Written as matras joined to the stem, NOT as separate letters: the
    // locative of সাল is সালে, which is সাল plus the vowel sign ে. So every
    // entry here is the dependent form, and a list of independent vowels would
    // match nothing.
    clitics: [
      // classifiers and determiners
      'টি',
      'টা',
      'টো',
      'খানা',
      'খানি',
      'গুলো',
      'গুলি',
      'গুলা',
      'জন',
      // plural
      'রা',
      'দের',
      'এরা',
      // case: genitive র after a vowel and ের after a consonant, objective কে,
      // locative ে and তে and য়
      'ের',
      'ে',
      'র',
      'য়',
      'তে',
      'কে',
      // emphatic ই and additive ও, which attach to a finished word: থেকেই is
      // থেকে + ই and হলেও is হলে + ও
      'ই',
      'ও',
      // the negative perfect, written solid: হয়নি is হয় + নি
      'নি',
    ],
    // Three, which is what the deepest real stack needs: গুলো + র on a noun,
    // or দের + কে. A fourth pass only invents stems.
    maxClitics: 3,
    // Two. A one-syllable Bengali noun is a common word and is two code points
    // once its vowel is written — বই is ব + ই and মা is ম + া — so a floor of
    // three would refuse to peel exactly the words that carry these suffixes
    // most often.
    minStem: 2,
  },
};
