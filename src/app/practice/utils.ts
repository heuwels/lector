import { splitTrailingPunctuation } from '@/lib/words';
import {
  clozeTokenSeparator,
  foldApostrophesFor,
  foldForComparison,
  graphemeLength,
  lowerForPack,
  normalizeText,
  resolveClozeTokens,
  type LanguageConfig,
} from '@/lib/languages';
import { ClozeMasteryLevel, ClozeSentence } from '@/types';
import { DictationDiff, DictationWord, FuzzyStatus, PracticeMode } from './types';
import { DICTATION_PASS_THRESHOLD, DICTATION_POINTS_BASE } from './constants';

// Helper export function to create blanked sentence, moving punctuation outside the blank.
//
// Tokens come from the row (#289 4.3) rather than a whitespace split here: an
// unspaced CJK sentence has no whitespace to split on, and rejoining its tokens
// with spaces would write spaces into Chinese prose. `clozeTokenSeparator`
// picks the separator that rebuilds the sentence, so spaced scripts are
// unchanged.
export function createBlankedSentence(
  sentence: string,
  wordIndex: number,
  tokens?: string[] | null,
  pack?: LanguageConfig,
): string {
  const resolved = resolveClozeTokens(sentence, tokens, pack);
  // Read the separator off the UNEDITED array — once the blank replaces a
  // token, neither candidate join rebuilds the sentence any more.
  const separator = clozeTokenSeparator(sentence, resolved, pack);
  const words = [...resolved];
  const [, punct] = splitTrailingPunctuation(words[wordIndex] ?? '');
  words[wordIndex] = '_____' + punct;
  return words.join(separator);
}

// Helper export function to normalize text for comparison. NFC first (#289):
// decomposed typed input (macOS dead keys, some IMEs) must compare equal to
// the bank's precomposed text. The ano teleia · is Greek's strong colon —
// punctuation like the rest of the class. Packs with `practiceLeniency:
// 'fold-marks'` (grc) additionally compare mark-stripped: typed λογος matches
// the bank's λόγος (#289 Phase 3).
//
// Lowercasing goes through the pack (tr): the bank keeps a sentence-initial
// answer as written, so grading "İyi" against typed "iyi" needs the Turkish
// mapping. The default one leaves a combining dot behind and fails a correct
// answer.
//
// Packs that spell words with an apostrophe (uk, it) keep it: it is part of
// п'ять and C'è, not punctuation, and dropping it would accept a misspelling.
// The variants fold to ASCII ' first, so the answer grades the same whichever
// apostrophe the keyboard produced.
// An apostrophe at an edge is a quote mark, never a letter — no Ukrainian word
// starts or ends with one — so it drops even in the keep-the-apostrophe path.
const PUNCTUATION = /[.,!?¿¡;:·'"„“”‚‘’«»‹›()[\]{}…]/gu;
const PUNCTUATION_KEEPING_APOSTROPHE = /[.,!?¿¡;:·"„“”‚«»‹›()[\]{}…]/gu;
const EDGE_APOSTROPHES = /^'+|'+$/g;

export function normalize(s: string, pack?: LanguageConfig): string {
  const normalized = normalizeText(s);
  const keepApostrophe = pack?.script.foldApostrophes === true;
  const folded = pack ? foldApostrophesFor(normalized, pack) : normalized;
  const punctuation = keepApostrophe ? PUNCTUATION_KEEPING_APOSTROPHE : PUNCTUATION;
  let base = lowerForPack(folded, pack).replace(punctuation, '').trim();
  if (keepApostrophe) base = base.replace(EDGE_APOSTROPHES, '');
  return pack ? foldForComparison(base, pack) : base;
}

// Helper export function to check answer (case-insensitive, ignores punctuation)
export function checkAnswer(
  userAnswer: string,
  correctWord: string,
  pack?: LanguageConfig,
): boolean {
  return normalize(userAnswer, pack) === normalize(correctWord, pack);
}

export function getFuzzyStatus(
  userInput: string,
  correctWord: string,
  pack?: LanguageConfig,
): FuzzyStatus {
  if (!userInput.trim()) return 'empty';

  const input = normalize(userInput, pack);
  const correct = normalize(correctWord, pack);

  if (input === correct) return 'match';
  if (input.length <= correct.length && correct.startsWith(input)) return 'partial';

  return 'wrong';
}

// Calculate next review date based on mastery level
export function calculateNextReview(mastery: ClozeMasteryLevel): Date {
  const now = new Date();
  const intervals: Record<ClozeMasteryLevel, number> = {
    0: 0,
    25: 1,
    50: 3,
    75: 7,
    100: 14,
  };
  const days = intervals[mastery];
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// Calculate points for a correct answer, following Clozemaster's formula:
//   base × (mastery% ÷ 25)
// where base is 8 for typed answers and 4 for multiple choice. `mastery` is the
// level reached *after* the answer (0/25/50/75/100), so leveling a card up pays
// more. Typed answers keep a hint penalty: revealing letters scales the award
// down by the fraction of the word given away (MC has no hints, so it's unaffected).
export function calculatePoints(
  mastery: ClozeMasteryLevel,
  hintLetters: number,
  wordLength: number,
  mode: PracticeMode,
): number {
  const base = mode === 'mc' ? 4 : 8;
  const masteryMultiplier = mastery / 25;
  const revealed = wordLength > 0 ? hintLetters / wordLength : 0;

  return Math.max(0, Math.round(base * masteryMultiplier * (1 - revealed)));
}

// Generate distractors from the queue/pool of cloze words
export function generateDistractors(
  correctWord: string,
  pool: ClozeSentence[],
  contextWords: string[] = [],
): string[] {
  const correctNorm = normalize(correctWord);
  // Grapheme count, not code units (#289): combining marks and surrogate
  // pairs would otherwise skew the length-similarity sort.
  const correctLen = graphemeLength(correctNorm);

  const candidates: string[] = [];
  const seen = new Set<string>();
  seen.add(correctNorm);

  for (const s of pool) {
    const norm = normalize(s.clozeWord);
    if (!seen.has(norm) && norm.length > 0) {
      seen.add(norm);
      candidates.push(s.clozeWord);
    }
  }

  // A very small guided round eventually shrinks to one remaining card. Its
  // source-text words keep multiple choice meaningful without introducing
  // generic fallback words from the wrong language.
  for (const word of contextWords) {
    const norm = normalize(word);
    if (!seen.has(norm) && norm.length > 0) {
      seen.add(norm);
      candidates.push(word);
    }
  }

  // Sort by length similarity to the correct word (in graphemes)
  candidates.sort((a, b) => {
    const diffA = Math.abs(graphemeLength(normalize(a)) - correctLen);
    const diffB = Math.abs(graphemeLength(normalize(b)) - correctLen);
    return diffA - diffB;
  });

  // Pick top candidates then shuffle
  const topCandidates = candidates.slice(0, Math.min(12, candidates.length));
  for (let i = topCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
  }

  return topCandidates.slice(0, 3);
}

// Shuffle array (Fisher-Yates)
export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Build a multiple-choice set from the current practice pool, optionally
// supplemented by words from the source text. Small normal rounds still show
// fewer choices; guided onboarding supplies its own same-language text words.
export function buildMultipleChoiceOptions(
  correctWord: string,
  pool: ClozeSentence[],
  contextWords: string[] = [],
): { options: string[]; correctIndex: number } {
  const cleanCorrect = splitTrailingPunctuation(correctWord)[0];
  const cleanDistractors = generateDistractors(correctWord, pool, contextWords).map(
    (distractor) => splitTrailingPunctuation(distractor)[0],
  );
  const options = shuffle([cleanCorrect, ...cleanDistractors]);
  const correctIndex = options.findIndex((option) => normalize(option) === normalize(cleanCorrect));

  return { options, correctIndex };
}

// --- Dictation scoring ------------------------------------------------------

// Compare what the user typed against the actual sentence at the word level.
// Words are matched on their normalized form (case- and punctuation-insensitive,
// per the issue) using a longest-common-subsequence alignment, so a dropped or
// inserted word shifts alignment instead of marking everything after it wrong.
// The returned tokens keep their original spelling for display.
export function diffDictation(typedRaw: string, actual: string): DictationDiff {
  const typedWords = typedRaw.trim().split(/\s+/).filter(Boolean);
  const actualWords = actual.trim().split(/\s+/).filter(Boolean);
  const t = typedWords.map((w) => normalize(w));
  const a = actualWords.map((w) => normalize(w));
  const n = t.length;
  const m = a.length;

  // dp[i][j] = LCS length of t[i..] and a[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = t[i] === a[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack the alignment, flagging which words on each side were matched.
  const typedMatched = new Array<boolean>(n).fill(false);
  const actualMatched = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (t[i] === a[j]) {
      typedMatched[i] = true;
      actualMatched[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const expected: DictationWord[] = actualWords.map((text, k) => ({
    text,
    status: actualMatched[k] ? 'correct' : 'missing',
  }));
  const typed: DictationWord[] = typedWords.map((text, k) => ({
    text,
    status: typedMatched[k] ? 'correct' : 'wrong',
  }));
  const correctWords = actualMatched.reduce((acc, ok) => acc + (ok ? 1 : 0), 0);
  const totalWords = m;
  const accuracy = totalWords > 0 ? correctWords / totalWords : 0;

  return { expected, typed, correctWords, totalWords, accuracy };
}

// Grade a dictation diff: a pass (advances the SRS card) needs at least
// DICTATION_PASS_THRESHOLD of the words right; perfect means every word matched
// with nothing extra typed.
export function scoreDictation(diff: DictationDiff): { isPass: boolean; isPerfect: boolean } {
  const isPerfect =
    diff.totalWords > 0 && diff.accuracy === 1 && diff.typed.every((w) => w.status === 'correct');
  const isPass = diff.totalWords > 0 && diff.accuracy >= DICTATION_PASS_THRESHOLD;
  return { isPass, isPerfect };
}

// Points for a passed dictation: base × (mastery reached ÷ 25) × accuracy, so a
// near-perfect transcription earns slightly less than a flawless one ("partial
// points for minor errors"). A failed attempt resets to mastery 0 and earns none.
export function calculateDictationPoints(mastery: ClozeMasteryLevel, accuracy: number): number {
  const masteryMultiplier = mastery / 25;
  return Math.max(0, Math.round(DICTATION_POINTS_BASE * masteryMultiplier * accuracy));
}
