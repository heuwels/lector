const AVOID_WORDS = new Set([
  // articles / determiners
  "de", "het", "een", "'t", "'n", "deze", "die", "dit", "dat", "zo'n",
  // conjunctions
  "en", "of", "maar", "want", "dus", "als", "dan", "omdat", "toen", "terwijl",
  "hoewel", "noch",
  // prepositions
  "in", "op", "aan", "bij", "met", "van", "voor", "naar", "uit", "over",
  "onder", "door", "om", "te", "tot", "tegen", "tussen", "na", "sinds", "af",
  // pronouns
  "ik", "jij", "je", "hij", "zij", "ze", "wij", "we", "u", "men",
  "wie", "wat", "jullie", "hen", "hun", "mij", "me", "jou", "ons", "er",
  // auxiliary / very common verbs
  "is", "ben", "bent", "zijn", "was", "waren", "heeft", "hebben", "had", "heb",
  "wordt", "worden", "werd", "zal", "zou", "kan", "kunnen", "moet", "moeten", "mag",
  "wil", "doet", "gaat", "komt",
  // adverbs / particles
  "niet", "wel", "ook", "al", "nog", "zo", "nu", "net", "eerst", "toch",
  "hier", "daar", "heel", "erg", "meer", "geen", "even", "reeds",
  // possessives
  "mijn", "jouw", "onze", "uw",
  // clitic fragments — bare letters left when the apostrophe splits a token
  // (foto's → foto + s, 't → t, z'n → z + n): never worth blanking.
  "t", "n", "s", "z", "m", "d", "r",
]);

export const nl = {
  name: 'Dutch',
  native: 'Nederlands',
  code: 'nl' as const,
  flag: '\u{1F1F3}\u{1F1F1}',
  ttsCode: 'nl-NL',
  // nl-NL has no Standard-A (like fr-FR) — Standard-F is the female Standard
  // voice, matching af/de/es's Standard-A tier + gender. Verified against the
  // live voices API 2026-07-08 (nl-NL Standard voices: F female, G male).
  ttsVoice: 'nl-NL-Standard-F',
  tatoebaCode: 'nld',
  fallbackTts: ['nl', 'nl-NL', 'nl-BE'],
  avoidWords: AVOID_WORDS,
  testPhrase: 'Hallo, hoe gaat het met je?',
  script: {
    bcp47: 'nl',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
    // 'n (een) is a token of its own, like the Afrikaans article — zo'n →
    // zo + 'n, m'n → m + 'n. Other clitics keep splitting bare ('t → t,
    // foto's → foto + s), which the avoidWords fragments above rely on.
    // Unicode-aware boundary, not \b — see the af manifest ("‘Ná" bug).
    extraTokenPatterns: ["['‘’ʼ`]n(?![\\p{L}\\p{M}0-9_])"],
  },
};
