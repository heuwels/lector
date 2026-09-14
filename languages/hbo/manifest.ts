// Biblical Hebrew (#255). Ancient-corpus pack after Koine Greek: frequency and
// cloze come from the Tanakh (OSHB), not from Tatoeba or wordfreq. Those two
// sources are Modern Hebrew and the wrong register.
//
// The written form and the dictionary key differ by default. A verse prints
// בְּרֵאשִׁית and the key is בראשית. See foldHebrewKey in languages/text.ts.
// Final letter forms stay on the key and fold only at lookup (hebrewLooseKey),
// so מלך keeps its final kaf and מלכ still resolves.

import { foldHebrewKey } from '../text';

// Cloze stop-words. EVERY ENTRY IS THE UNPOINTED KEY, finals kept. foldHebrewKey
// strips niqqud and cantillation, so a pointed spelling here would never match.
const AVOID_RAW = [
  // object marker and core prepositions
  'את',
  'על',
  'אל',
  'מן',
  'עד',
  'עם',
  'בין',
  'אחר',
  'אחרי',
  'לפני',
  'תחת',
  'מפני',
  // conjunctions and subordinators
  'כי',
  'אם',
  'או',
  'גם',
  'אך',
  'רק',
  'אשר',
  'לכן',
  'פן',
  // negation and existence
  'לא',
  'אין',
  'יש',
  // pronouns
  'אני',
  'אתה',
  'אתם',
  'אתן',
  'אנחנו',
  'הוא',
  'היא',
  'הם',
  'הן',
  'זה',
  'זאת',
  'אלה',
  // interrogatives
  'מה',
  'מי',
  'למה',
  'מדוע',
  // quantifiers and particles
  'כל',
  'כן',
  'הנה',
  'עתה',
  'נא',
  // high-frequency forms of היה
  'היה',
  'היו',
  'יהי',
];

const AVOID_WORDS = new Set(AVOID_RAW.map(foldHebrewKey));

export const hbo = {
  name: 'Biblical Hebrew',
  native: 'עברית מקראית',
  // Scroll, not the modern Israeli flag. This pack is the language of the
  // Tanakh, not Modern Hebrew (#255).
  code: 'hbo' as const,
  flag: '\u{1F4DC}',
  // Tatoeba `heb` is Modern Hebrew. The field is required; nothing reads it
  // for this pack. Cloze comes from verse pairs instead.
  tatoebaCode: 'hbo',
  avoidWords: AVOID_WORDS,
  testPhrase: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים',
  // Reconstructed pronunciation is disputed, as with Koine and Latin. The
  // speaker UI absents itself rather than speaking Israeli Hebrew over a verse.
  pronunciation: { audio: 'none' as const },
  script: {
    bcp47: 'hbo',
    direction: 'rtl' as const,
    kind: 'alpha-spaced' as const,
    hasCase: false,
    // Sof pasuq ends a verse. Editions also use the Latin full stop.
    sentenceTerminators: '.!?׃',
    // Maqaf joins two lexemes into one written word (גַם־שְׁנֵיהֶם). The
    // default engine treats U+05BE as a boundary; this pack does not.
    extraJoiners: '\u05BE',
    // A learner types unpointed Hebrew. Accept a mark-stripped answer, the same
    // concession Arabic and Koine get. foldForComparison uses foldHebrewKey,
    // not stripMarks: that Greek fold is not this script's mark set.
    practiceLeniency: 'fold-marks' as const,
  },
  // Biblical Hebrew writes its grammar as proclitics and suffixes with no
  // space. OSHB marks the cuts in the Tanakh. Running text outside the corpus
  // still needs a peel, the same shape as Arabic.
  morphology: {
    clitics: ['ני', 'נו', 'כם', 'כן', 'הו', 'הא', 'הם', 'הן', 'י', 'ך', 'ו', 'ה', 'ם', 'ן'],
    maxClitics: 1,
    prefixes: ['ו', 'ה', 'ב', 'ל', 'כ', 'מ', 'ש'],
    // ו + ב + ה is the deepest real stack: ובהשמים.
    maxPrefixes: 3,
    // Two. A one-letter remainder is a prefix, not a stem. כי / לא / אל take
    // a conjunction and must still resolve.
    minStem: 2,
  },
};
