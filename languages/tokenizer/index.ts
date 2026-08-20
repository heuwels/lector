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
//   `script.extraTokenPatterns` (af 'n), `script.extraWordChars`, or
//   `script.extraJoiners` (uk: п'ять is one word).
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

// ---------------------------------------------------------------------------
// Unspaced-CJK engine (#289 Phase 4, item 4.1)
// ---------------------------------------------------------------------------
// zh/ja text has no whitespace to split on, so the regex engine above sees one
// long letter run and returns it as a single token. `cjk-unspaced` packs
// dispatch here instead, to `Intl.Segmenter` word granularity — ICU's
// dictionary-based segmenter, present in Bun and in every target browser, with
// no dependency to vendor. A quality segmenter (jieba, MeCab) replaces the two
// call sites below without touching this module's public signatures.
//
// Known divergence from the regex engine, and deliberate: ICU splits a Latin
// compound inside CJK text on the hyphen ("COVID-19" → COVID | 19), where the
// regex engine joins it. Only `cjk-unspaced` packs see this, and a Latin
// compound embedded in Chinese prose is rare enough to leave alone until the
// quality segmenter lands.

const wordSegmenters = new Map<string, Intl.Segmenter>();

function wordSegmenter(bcp47: string): Intl.Segmenter {
  let segmenter = wordSegmenters.get(bcp47);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(bcp47, { granularity: 'word' });
    wordSegmenters.set(bcp47, segmenter);
  }
  return segmenter;
}

/**
 * Tokenize via the segmenter, preserving the module contract: an exhaustive
 * stream whose `text` values concatenate back to the source, with exact
 * offsets. Adjacent non-word segments merge into one gap token, so the stream
 * has the same shape the regex engine produces — one gap between two words.
 */
function tokenizeSegmented(
  text: string,
  script: ScriptConfig,
  words?: WordSegmentation | null,
): Token[] {
  if (words) return tokenizeByWordList(text, words);
  const tokens: Token[] = [];
  for (const { segment, index, isWordLike } of wordSegmenter(script.bcp47).segment(text)) {
    const end = index + segment.length;
    const previous = tokens[tokens.length - 1];
    if (!isWordLike && previous && !previous.isWord) {
      previous.text += segment;
      previous.end = end;
      continue;
    }
    tokens.push({ text: segment, start: index, end, isWord: Boolean(isWordLike) });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Word-list segmentation (#289 Phase 4, item 4.2)
// ---------------------------------------------------------------------------
// A quality segmenter (jieba, MeCab/UniDic) cannot run in the browser, so its
// output has to travel with the lesson. It travels as a WORD LIST rather than
// as token offsets, because the reader never sees the stored text: it renders
// markdown, and `ReaderArticle.renderChildren` tokenizes each string leaf of
// the parsed AST. Markdown syntax is consumed by the parser and inline emphasis
// splits a sentence mid-clause, so offsets into `lessons.textContent` cannot
// address rendered spans — measured on 我**喜欢**读书。, whose leaves are
// ["我", "喜欢", "读书。这是", …] and do not rejoin to the source.
//
// A word list survives that fragmentation, because longest-match is positional
// only within the leaf it is given. It is also far smaller: one entry per
// DISTINCT form rather than one pair per token occurrence.

/** A lesson's segmentation vocabulary, prepared for longest-match. */
export interface WordSegmentation {
  has(word: string): boolean;
  /** Longest entry, in UTF-16 code units — bounds the match window. */
  maxLength: number;
  size: number;
}

/**
 * Build a segmentation from a stored word list. Returns null for an empty or
 * absent list so callers can treat "no segmentation" as one falsy check and
 * fall back to `Intl.Segmenter`.
 */
export function makeWordSegmentation(
  words: readonly string[] | null | undefined,
): WordSegmentation | null {
  if (!words || words.length === 0) return null;
  const set = new Set<string>();
  let maxLength = 0;
  for (const word of words) {
    if (typeof word !== 'string' || word.length === 0) continue;
    set.add(word);
    if (word.length > maxLength) maxLength = word.length;
  }
  if (set.size === 0) return null;
  return { has: (word) => set.has(word), maxLength, size: set.size };
}

/** A character that is part of a word when no list entry covers it. */
const WORD_CODEPOINT = /[\p{L}\p{N}\p{M}]/u;

/**
 * Greedy longest-match against the lesson's vocabulary.
 *
 * Satisfies the same contract as every other engine here: the stream is
 * exhaustive, `text` values concatenate back to the source byte-for-byte, and
 * offsets are exact. A character no entry covers becomes its own single-
 * character token, word or gap by Unicode category, so an unknown character
 * stays tappable instead of vanishing.
 */
function tokenizeByWordList(text: string, words: WordSegmentation): Token[] {
  const tokens: Token[] = [];

  const pushWord = (value: string, start: number) => {
    tokens.push({ text: value, start, end: start + value.length, isWord: true });
  };
  const pushGap = (value: string, start: number) => {
    const previous = tokens[tokens.length - 1];
    if (previous && !previous.isWord) {
      previous.text += value;
      previous.end = start + value.length;
      return;
    }
    tokens.push({ text: value, start, end: start + value.length, isWord: false });
  };

  let i = 0;
  while (i < text.length) {
    // Longest first. The window is bounded by the longest stored entry, so a
    // pathological list cannot make this quadratic in the text length.
    const window = Math.min(words.maxLength, text.length - i);
    let matched = '';
    for (let length = window; length >= 1; length--) {
      const candidate = text.slice(i, i + length);
      if (words.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      pushWord(matched, i);
      i += matched.length;
      continue;
    }

    // No entry covers this position. Advance one CODE POINT, not one code
    // unit, or an astral CJK character (𠮷, U+20BB7) would be split into two
    // lone surrogates and rendered as tofu.
    const codePoint = text.codePointAt(i);
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const char = text.slice(i, i + width);
    if (WORD_CODEPOINT.test(char)) pushWord(char, i);
    else pushGap(char, i);
    i += width;
  }

  return tokens;
}

/**
 * Expand [start, end) to segmenter token boundaries. The regex engine's
 * character-walk cannot work here: every character of an unspaced run is a
 * word character, so walking outward would swallow the whole paragraph.
 */
function snapSegmented(
  text: string,
  start: number,
  end: number,
  script: ScriptConfig,
  words?: WordSegmentation | null,
): { start: number; end: number } {
  let snappedStart = start;
  let snappedEnd = end;
  // Must walk the SAME boundaries the render used, or a tap resolves to a word
  // the reader never drew: the list and Intl.Segmenter disagree by design.
  const spans: Iterable<{ index: number; length: number }> = words
    ? tokenizeByWordList(text, words).map((t) => ({ index: t.start, length: t.text.length }))
    : [...wordSegmenter(script.bcp47).segment(text)].map((s) => ({
        index: s.index,
        length: s.segment.length,
      }));
  for (const { index, length } of spans) {
    const spanEnd = index + length;
    if (index <= start && start < spanEnd) snappedStart = index;
    if (index < end && end <= spanEnd) snappedEnd = spanEnd;
  }
  return { start: snappedStart, end: snappedEnd };
}

/** Closing marks that belong to the sentence they follow, not the next one. */
const SENTENCE_CLOSERS = '」』”’〞》〉】］）"\')]';

/**
 * Sentence splitting for unspaced scripts. The spaced splitter requires
 * whitespace after the terminator, which Chinese prose never writes — 。 ends a
 * sentence and the next one starts at the very next character. So scan instead:
 * break after a run of terminators plus any closing quotes or brackets, and
 * consume whitespace at the break the way the spaced splitter does.
 */
function splitSentencesSegmented(text: string, script: ScriptConfig): string[] {
  const terminators = new Set(script.sentenceTerminators ?? DEFAULT_SENTENCE_TERMINATORS);
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (!terminators.has(text[i])) {
      i++;
      continue;
    }
    let cut = i + 1;
    while (cut < text.length && terminators.has(text[cut])) cut++;
    while (cut < text.length && SENTENCE_CLOSERS.includes(text[cut])) cut++;
    let next = cut;
    while (next < text.length && /\s/.test(text[next])) next++;
    sentences.push(text.slice(start, cut));
    start = next;
    i = next;
  }
  if (start < text.length) sentences.push(text.slice(start));
  // `''.split(re)` yields [''] — match that for an empty or all-whitespace input.
  return sentences.length > 0 ? sentences : [text];
}

function compile(script: ScriptConfig): CompiledScript {
  const cached = compiledCache.get(script);
  if (cached) return cached;

  const extra = escapeForCharClass(script.extraWordChars ?? '');
  const wc = `[${WORD_CHAR}${extra}]`;
  // Hyphens always join; packs add more (uk: the apostrophe in п'ять). A joiner
  // is only a word character BETWEEN two runs, so a leading or trailing quote
  // mark stays outside the token.
  const joiners = HYPHEN_JOINERS + escapeForCharClass(script.extraJoiners ?? '');
  // A word: a run of word characters, optionally continued by joined runs.
  const core = `${wc}+(?:[${joiners}]${wc}+)*`;
  // Pack-specific whole-token forms (af 'n) take precedence over the engine.
  const alternatives = [...(script.extraTokenPatterns ?? []), core];
  const terminators = escapeForCharClass(
    script.sentenceTerminators ?? DEFAULT_SENTENCE_TERMINATORS,
  );

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
 * `cjk-unspaced` packs dispatch to the segmenter engine instead of the regex
 * engine; both satisfy the contract above.
 *
 * `words` is the lesson's stored segmentation (#289 4.2). When present, an
 * unspaced pack matches against it instead of calling `Intl.Segmenter`, which
 * is how a server-side quality segmenter reaches the browser. Spaced packs
 * ignore it: whitespace is already an exact answer.
 */
export function tokenize(
  text: string,
  pack: LanguageConfig,
  words?: WordSegmentation | null,
): Token[] {
  if (pack.script.kind === 'cjk-unspaced') return tokenizeSegmented(text, pack.script, words);
  const { wordPattern } = compile(pack.script);
  const tokens: Token[] = [];
  const re = new RegExp(wordPattern.source, wordPattern.flags); // own lastIndex
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        text: text.slice(lastIndex, match.index),
        start: lastIndex,
        end: match.index,
        isWord: false,
      });
    }
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isWord: true,
    });
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
export function tokenizeWords(
  text: string,
  pack: LanguageConfig,
  words?: WordSegmentation | null,
): Token[] {
  return tokenize(text, pack, words).filter((t) => t.isWord);
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
  words?: WordSegmentation | null,
): { start: number; end: number } {
  if (pack.script.kind === 'cjk-unspaced') {
    return snapSegmented(text, start, end, pack.script, words);
  }
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
  if (pack.script.kind === 'cjk-unspaced') return splitSentencesSegmented(text, pack.script);
  return text.split(compile(pack.script).sentenceSplitter);
}

/**
 * Word count for lesson stats. Spaced scripts keep the historical whitespace
 * count, so wordCount values for existing lessons stay byte-identical. Unspaced
 * CJK counts segmenter tokens instead (#289 4.6) — a whitespace count of a
 * Chinese lesson is 1, which makes lesson length, reading estimates and the
 * "words read" statistic meaningless.
 *
 * Callers that can resolve the content's language MUST pass its pack. The
 * optional parameter exists for paths that genuinely have no language in hand,
 * and those silently get the spaced count.
 */
export function countWords(text: string, pack?: LanguageConfig): number {
  const stripped = text.replace(/[#*`\[\]()]/g, '');
  if (pack?.script.kind === 'cjk-unspaced') return tokenizeWords(stripped, pack).length;
  return stripped.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Word count for prose the user typed rather than imported — journal entries.
 * Deliberately separate from `countWords`: that one strips markdown syntax
 * first, and a journal count is metered against a monthly allowance, so the
 * stripping must not be able to move the charge. Spaced scripts keep the exact
 * historical count; unspaced CJK counts segmenter tokens (#289 4.6), without
 * which a Chinese journal entry of any length charges one word.
 */
export function countTypedWords(text: string, pack?: LanguageConfig): number {
  if (pack?.script.kind === 'cjk-unspaced') return tokenizeWords(text, pack).length;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The string that rejoins a cloze token array into its sentence (#289 4.3).
 *
 * Inferred from the data, not from a pack: whichever separator reproduces the
 * sentence is the one the array was split on. That keeps every caller — the
 * practice reducer especially — free of a pack it has no way to resolve, and it
 * stays right even for a row whose stored array disagrees with the pack's
 * current segmenter. `pack` is only a last resort when neither candidate
 * rebuilds the sentence, which happens when the tokens have been edited (the
 * blanked sentence) rather than read straight from the row.
 */
export function clozeTokenSeparator(
  sentence: string,
  tokens: readonly string[],
  pack?: LanguageConfig,
): string {
  if (tokens.length < 2) return pack?.script.kind === 'cjk-unspaced' ? '' : ' ';
  if (tokens.join('') === sentence) return '';
  if (tokens.join(' ') === sentence) return ' ';
  return pack?.script.kind === 'cjk-unspaced' ? '' : ' ';
}

/**
 * The display tokens a cloze row's `clozeIndex` points into (#289 4.3).
 *
 * This is the FALLBACK for a row that carries no stored `tokens` array, which
 * is every row seeded before 4.3. It is deliberately NOT `tokenize`:
 *
 *   `clozeIndex` was written as a WHITESPACE-token index, and the tokenizer
 *   does not agree with whitespace on spaced scripts. French `L'eau est belle`
 *   is 3 whitespace tokens but 4 tokenizer tokens, so re-deriving through the
 *   tokenizer would move every stored index past an apostrophe onto the wrong
 *   word. Spaced packs therefore keep `split(/\s+/)` forever — the index is
 *   preserved by construction, and shipped banks stay byte-identical.
 *
 * Only `cjk-unspaced` packs, which have no legacy rows and no whitespace to
 * split on, derive their tokens from the segmenter.
 */
export function clozeTokens(sentence: string, pack?: LanguageConfig): string[] {
  if (pack?.script.kind === 'cjk-unspaced') {
    return tokenizeSegmented(sentence, pack.script)
      .map((token) => token.text)
      .filter((text) => text.length > 0);
  }
  return sentence.split(/\s+/);
}

/**
 * The display tokens for a cloze row, preferring the array the bank stored.
 * A stored array is authoritative: it is what the builder indexed against, so
 * display and index cannot drift even if the segmenter later changes its mind.
 */
export function resolveClozeTokens(
  sentence: string,
  stored: string[] | null | undefined,
  pack?: LanguageConfig,
): string[] {
  if (stored && stored.length > 0) return stored;
  return clozeTokens(sentence, pack);
}
