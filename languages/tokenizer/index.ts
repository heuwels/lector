// Script-agnostic tokenizer (#289 Phase 0, item 0.4) — the seam the
// multi-script language packs (#212 ru, #213 zh, #214 ja, #253 ar, #254 grc,
// #255 hbo, #258 ko) plug into. Dispatches on `pack.script.kind`; the default
// engine covers every spaced alphabetic script (Latin, Cyrillic, Greek,
// Hangul, Arabic, Hebrew) with Unicode property escapes — no per-language
// character ranges anywhere.
//
// Word-shape notes (kept byte-compatible with the old Latin WORD_PATTERN for
// shipped languages):
// - Digits and underscore stay word characters (the old `\w` behavior): years
//   ("1999") and letter-digit compounds ("COVID-19") tokenize as before.
//   Arabic-Indic digits (U+0660-0669) are deliberately NOT word characters —
//   they act as boundaries, per #289.
// - Only true hyphens join compounds: ASCII '-', U+2010 hyphen, U+2011
//   non-breaking hyphen. En/em dashes and the Hebrew maqaf (U+05BE) are
//   boundaries (maqaf-joined words are separate tokens, per #289 Phase 3).
// - Apostrophes split words (l'eau → l + eau, foto's → foto + s) exactly as
//   before; packs opt into apostrophe-bearing tokens via
//   `script.extraTokenPatterns` (af 'n) or `script.extraWordChars`.
// - Combining marks (\p{M}) are word characters so decomposed sequences and
//   pointed Arabic/Hebrew text keep words whole; NFC at ingress (text.ts)
//   makes this a no-op for shipped languages.

import type { LanguageConfig, ScriptConfig } from '../types';

export interface Token {
  /** The exact substring, unmodified. */
  text: string;
  /** Start offset in the source string (UTF-16 code units). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** True for word tokens, false for the gaps (whitespace/punctuation) between them. */
  isWord: boolean;
}

const WORD_CHAR = '\\p{L}\\p{M}0-9_';
const HYPHEN_JOINERS = '\\-\\u2010\\u2011';
const APOSTROPHES = "'\\u2018\\u2019\\u02BC`";
const DEFAULT_SENTENCE_TERMINATORS = '.!?';

/** Escape a string for interpolation inside a regex character class. */
function escapeForCharClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, '\\$&');
}

interface CompiledScript {
  /** Global word-token pattern; callers must clone or reset lastIndex. */
  wordPattern: RegExp;
  /** Single-character test: can this char be part of a word token? */
  wordChar: RegExp;
  /** Single-character test for selection snapping (word chars + apostrophes + hyphens). */
  selectionChar: RegExp;
  /** Splitter producing sentences (terminator kept, following whitespace consumed). */
  sentenceSplitter: RegExp;
}

const compiledCache = new WeakMap<ScriptConfig, CompiledScript>();

function compile(script: ScriptConfig): CompiledScript {
  const cached = compiledCache.get(script);
  if (cached) return cached;

  const extra = escapeForCharClass(script.extraWordChars ?? '');
  const wc = `[${WORD_CHAR}${extra}]`;
  // A word: a run of word characters, optionally continued by hyphenated runs.
  const core = `${wc}+(?:[${HYPHEN_JOINERS}]${wc}+)*`;
  // Pack-specific whole-token forms (af 'n) take precedence over the engine.
  const alternatives = [...(script.extraTokenPatterns ?? []), core];
  const terminators = escapeForCharClass(script.sentenceTerminators ?? DEFAULT_SENTENCE_TERMINATORS);

  const compiled: CompiledScript = {
    wordPattern: new RegExp(alternatives.join('|'), 'giu'),
    wordChar: new RegExp(`[${WORD_CHAR}${extra}]`, 'u'),
    selectionChar: new RegExp(`[${WORD_CHAR}${extra}${APOSTROPHES}${HYPHEN_JOINERS}]`, 'u'),
    sentenceSplitter: new RegExp(`(?<=[${terminators}])\\s+`, 'u'),
  };
  compiledCache.set(script, compiled);
  return compiled;
}

/**
 * Split `text` into an exhaustive sequence of word and non-word tokens with
 * source offsets. Concatenating `token.text` in order reproduces `text`
 * byte-for-byte.
 *
 * `cjk-unspaced` packs currently fall through to the spaced engine (an
 * unspaced run tokenizes as one letter run); the real segmentation engine
 * (Intl.Segmenter baseline, then jieba/MeCab) lands in Phase 4 of #289 behind
 * this same signature.
 */
export function tokenize(text: string, pack: LanguageConfig): Token[] {
  const { wordPattern } = compile(pack.script);
  const tokens: Token[] = [];
  const re = new RegExp(wordPattern.source, wordPattern.flags); // own lastIndex
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), start: lastIndex, end: match.index, isWord: false });
    }
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length, isWord: true });
    lastIndex = match.index + match[0].length;
    // A zero-length match (possible with pathological extraTokenPatterns)
    // would loop forever — step past it.
    if (match[0].length === 0) re.lastIndex++;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), start: lastIndex, end: text.length, isWord: false });
  }
  return tokens;
}

/** Just the word tokens of `tokenize` (order preserved). */
export function tokenizeWords(text: string, pack: LanguageConfig): Token[] {
  return tokenize(text, pack).filter((t) => t.isWord);
}

/** Can `ch` (a single character) appear inside a word token for this pack? */
export function isWordChar(ch: string, pack: LanguageConfig): boolean {
  return compile(pack.script).wordChar.test(ch);
}

/**
 * Expand a selection given as [start, end) offsets into `text` outward to
 * word boundaries. Selection snapping is more generous than tokenization: it
 * also crosses apostrophes and hyphens, so a drag starting inside "l'eau"
 * captures the whole elision. Pure — the DOM wrapper lives in the reader.
 */
export function snapToWordBoundaries(
  text: string,
  start: number,
  end: number,
  pack: LanguageConfig,
): { start: number; end: number } {
  const { selectionChar } = compile(pack.script);
  let s = start;
  let e = end;
  while (s > 0 && selectionChar.test(text[s - 1])) s--;
  while (e < text.length && selectionChar.test(text[e])) e++;
  return { start: s, end: e };
}

/**
 * Split a block of text into sentences on the pack's terminators (default
 * '.!?'). A terminator ends a sentence only when followed by whitespace, so
 * abbreviation-internal dots ("z.B.") don't split mid-token any more than
 * they used to.
 */
export function splitSentences(text: string, pack: LanguageConfig): string[] {
  return text.split(compile(pack.script).sentenceSplitter);
}

/**
 * Word count for lesson stats. For spaced scripts this is the historical
 * whitespace count (byte-identical wordCount values for existing lessons);
 * unspaced CJK gets a real token count in Phase 4 of #289 — until then it
 * falls through (counts are meaningless for unspaced text either way).
 */
export function countWords(text: string, pack?: LanguageConfig): number {
  void pack;
  return text
    .replace(/[#*`\[\]()]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}
