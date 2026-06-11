// Nested-definition links (issue #106).
// Form-of glosses from the kaikki Wiktionary dump reference their lemma in
// plain text ("plural of vrug", "past participle of breek"). This module finds
// that referenced word so the UI can make it clickable, while leaving ordinary
// English "of" phrases ("pound (unit of weight)", "capital of France") alone.

export interface NestedWordRef {
  /** Gloss text before the referenced word (ends with "of "). */
  prefix: string;
  /** The referenced word exactly as it appears in the gloss. */
  word: string;
  /** Gloss text after the referenced word (trailing punctuation/commentary). */
  suffix: string;
}

// A gloss only counts as a form-of reference when the word right before "of"
// is one of Wiktionary's form-of descriptors. Derived from a scan of every
// "… of …" gloss in dictionary-af.db — anything outside this set ("city of",
// "fear of", "made out of") is regular English and must not linkify.
const FORM_OF_KEYWORDS = new Set([
  'plural',
  'singular',
  'form',
  'diminutive',
  'augmentative',
  'abbreviation',
  'participle',
  'spelling',
  'synonym',
  'degree',
  'contraction',
  'misspelling',
  'initialism',
  'acronym',
  'preterite',
  'present',
  'past',
  'tense',
  'comparative',
  'superlative',
  'clipping',
  'feminine',
  'masculine',
]);

// Letters (incl. Latin diacritics used by Afrikaans: ê ë é ô ü ŉ …), hyphens
// and apostrophes — the shapes a headword can take. Anything else (digits,
// non-Latin scripts) isn't a useful lookup target.
const WORD_TOKEN = /^[A-Za-zÀ-ÖØ-öø-ž'’-]+$/;

/**
 * Find the form-of word reference in a gloss, if any.
 *
 * Returns the gloss split into prefix / word / suffix so callers can render
 * the word as a link, or null when the gloss has no unambiguous reference.
 * When several "<keyword> of" phrases appear, the last one wins — it is the
 * most specific ("… plural and singular of wees").
 */
export function findNestedWordRef(gloss: string): NestedWordRef | null {
  const keywordOf = /\b([A-Za-z-]+) of\s+/g;
  let match: RegExpExecArray | null = null;
  for (let m = keywordOf.exec(gloss); m !== null; m = keywordOf.exec(gloss)) {
    if (FORM_OF_KEYWORDS.has(m[1].toLowerCase())) match = m;
  }
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = gloss.slice(start);

  // The reference ends at the first delimiter — anything past it is
  // commentary ("… of wees, to be").
  const delimIdx = rest.search(/[,;:()]/);
  const segment = (delimIdx === -1 ? rest : rest.slice(0, delimIdx)).trimEnd();

  // Trailing sentence punctuation belongs to the gloss, not the word.
  const word = segment.replace(/[.!?'"’”]+$/, '');

  // Multi-word targets ("initialism of belasting op toegevoegde waarde") are
  // ambiguous to link — skip them rather than guess.
  if (!word || /\s/.test(word) || !WORD_TOKEN.test(word)) return null;

  return {
    prefix: gloss.slice(0, start),
    word,
    suffix: gloss.slice(start + word.length),
  };
}
