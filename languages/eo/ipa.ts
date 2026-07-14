// Rule-generated IPA for Esperanto (#307 §3.2b) — the pack's `gloss: 'ipa'`
// capability. Esperanto orthography is strictly one-letter-one-phoneme and
// stress is always penultimate, so pronunciation is a pure function of the
// spelling: no TTS, no dictionary data, no model. Shared by the API (attached
// to dictionary lookups in api/src/lib/dictionary-db.ts) and available to the
// client via the languages/ layer.
//
// Cross-checked against `espeak-ng -v eo --ipa` and Wiktionary transcriptions
// (see ipa.test.ts): ĝardeno → /d͡ʒarˈdeno/, scii → /ˈst͡sii/,
// kompreni → /komˈpreni/.

const PHONEMES: Record<string, string> = {
  a: 'a',
  b: 'b',
  c: 't͡s',
  ĉ: 't͡ʃ',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'ɡ',
  ĝ: 'd͡ʒ',
  h: 'h',
  ĥ: 'x',
  i: 'i',
  j: 'j',
  ĵ: 'ʒ',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  o: 'o',
  p: 'p',
  r: 'r',
  s: 's',
  ŝ: 'ʃ',
  t: 't',
  u: 'u',
  ŭ: 'w',
  v: 'v',
  z: 'z',
};

// Syllabic vowels. The glides j /j/ and ŭ /w/ are consonantal — the second
// element of the aj/ej/oj/uj/aŭ/eŭ diphthongs — so they never carry stress
// and never count as a syllable (hodiaŭ = ho·di·aŭ, three syllables).
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

// Muta cum liquida: an obstruent + l/r cluster syllabifies as one onset, so
// the stress mark lands before both (kom·pre·ni → /komˈpreni/, in·stru·i →
// /insˈtrui/). Keyed by PHONEME (post-mapping), hence ɡ/t͡s/etc.
const LIQUIDS = new Set(['l', 'r']);
const OBSTRUENTS = new Set([
  'p',
  'b',
  't',
  'd',
  'k',
  'ɡ',
  'f',
  'v',
  't͡s',
  't͡ʃ',
  'd͡ʒ',
  's',
  'z',
  'ʃ',
  'ʒ',
  'x',
]);

/**
 * Transliterate one Esperanto word (proper supersigno orthography) to a
 * phonemic IPA transcription with the fixed penultimate stress marked, e.g.
 * `ĝardeno` → `/d͡ʒarˈdeno/`. Returns null when the input isn't confidently
 * Esperanto (letters outside the 28-letter alphabet, digits, spaces) — the
 * caller should omit the gloss rather than show a wrong one.
 */
export function esperantoIpa(word: string): string | null {
  // Trailing apostrophe is the poetic o-elision (mond' = mondo): the vowel is
  // simply absent from the transcription. Any other apostrophe is not a word.
  const cleaned = word.normalize('NFC').toLowerCase().replace(/['’]$/u, '');
  if (!cleaned) return null;

  const phonemes: string[] = [];
  const vowelAt: number[] = [];
  for (const ch of cleaned) {
    const phoneme = PHONEMES[ch];
    if (!phoneme) return null;
    if (VOWELS.has(phoneme)) vowelAt.push(phonemes.length);
    phonemes.push(phoneme);
  }

  // Monosyllables (and vowel-less elisions like l') carry no stress mark,
  // matching Wiktionary convention: kaj → /kaj/.
  if (vowelAt.length >= 2) {
    const stressed = vowelAt[vowelAt.length - 2];
    let onset = stressed;
    if (onset > 0 && !VOWELS.has(phonemes[onset - 1])) {
      onset--; // single consonant joins the syllable it opens
      if (onset > 0 && LIQUIDS.has(phonemes[onset]) && OBSTRUENTS.has(phonemes[onset - 1])) {
        onset--; // muta cum liquida: pr/tr/kl/… stay one onset
      }
    }
    // If nothing to the left has a vowel, the whole initial cluster is the
    // onset (scii → /ˈst͡sii/, knabo → /ˈknabo/).
    if (!vowelAt.some((i) => i < onset)) onset = 0;
    phonemes.splice(onset, 0, 'ˈ');
  }

  return `/${phonemes.join('')}/`;
}
