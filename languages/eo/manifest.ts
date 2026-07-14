const AVOID_WORDS = new Set([
  // article + correlative determiners
  'la', 'tiu', 'tiuj', 'ĉiu', 'ĉiuj', 'iu', 'iuj', 'neniu', 'kiu', 'kiuj',
  // conjunctions / comparison
  'kaj', 'aŭ', 'sed', 'ke', 'ĉar', 'se', 'do', 'tamen', 'nek', 'ol',
  // prepositions
  'de', 'da', 'en', 'al', 'el', 'kun', 'por', 'pri', 'pro', 'per', 'je',
  'sur', 'sub', 'super', 'antaŭ', 'post', 'dum', 'tra', 'trans', 'ĉe',
  'ĝis', 'inter', 'kontraŭ', 'laŭ', 'apud', 'ĉirkaŭ', 'sen',
  // pronouns (+ accusative forms — -n is regular, so both surfaces occur)
  'mi', 'vi', 'li', 'ŝi', 'ĝi', 'ni', 'ili', 'oni', 'si', 'ci',
  'min', 'vin', 'lin', 'ŝin', 'ĝin', 'nin', 'ilin', 'sin',
  // possessives
  'mia', 'via', 'lia', 'ŝia', 'ĝia', 'nia', 'ilia', 'sia',
  // "to be" + very common auxiliaries
  'esti', 'estas', 'estis', 'estos', 'estus', 'estu', 'havas', 'povas',
  'devas', 'volas',
  // particles / high-frequency adverbs
  'ne', 'jes', 'ja', 'jam', 'ankoraŭ', 'nur', 'ankaŭ', 'tre', 'plej',
  'pli', 'tro', 'tiel', 'tiom', 'ĉi', 'for', 'plu', 'eĉ', 'nun', 'tie', 'ĉu',
  // poetic-elision fragment (de l' mondo → l + mondo): never worth blanking
  'l',
]);

export const eo = {
  name: 'Esperanto',
  native: 'Esperanto',
  code: 'eo' as const,
  // Unicode has no Esperanto flag emoji (the verda stelo) — 🟩 evokes the
  // green flag without a per-language render exception (#307 §3.4).
  flag: '🟩',
  tatoebaCode: 'epo',
  avoidWords: AVOID_WORDS,
  testPhrase: 'Saluton, kiel vi fartas?',
  // No Google (or reliable browser) voice exists for Esperanto — self-hosted
  // eSpeak NG is the only commercially-usable eo TTS (#307 §3.2c, locked
  // 2026-07-11). The orthography is strictly phonemic (one letter = one
  // phoneme, stress always penultimate), so lookups also carry a
  // rule-generated IPA gloss (languages/eo/ipa.ts). ttsCode/ttsVoice/
  // fallbackTts are Google-voice fields and are deliberately absent.
  pronunciation: { audio: ['espeak'] as const, gloss: 'ipa' as const },
  script: {
    bcp47: 'eo',
    direction: 'ltr' as const,
    kind: 'alpha-spaced' as const,
    hasCase: true,
    // The supersignoj (ĉ ĝ ĥ ĵ ŝ ŭ, U+0108–U+016D) are ordinary \p{L}
    // letters — the generic engine tokenizes them with no extra patterns.
    // Esperanto has no elision apostrophe in normal prose (poetic "l'"
    // aside, which correctly splits) and no digraphs.
  },
};
