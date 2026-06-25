import { splitTrailingPunctuation } from '@/lib/words';
import { ClozeMasteryLevel, ClozeSentence } from '@/types';
import { DictationDiff, DictationWord, FuzzyStatus, PracticeMode } from './types';
import { DICTATION_PASS_THRESHOLD, DICTATION_POINTS_BASE } from './constants';

// Helper export function to create blanked sentence, moving punctuation outside the blank
export function createBlankedSentence(sentence: string, wordIndex: number): string {
  const words = sentence.split(/\s+/);
  const [, punct] = splitTrailingPunctuation(words[wordIndex]);
  words[wordIndex] = '_____' + punct;
  return words.join(' ');
}

// Helper export function to normalize text for comparison
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:'"„“”‚‘’«»‹›()[\]{}…]/gu, '')
    .trim();
}

// Helper export function to check answer (case-insensitive, ignores punctuation)
export function checkAnswer(userAnswer: string, correctWord: string): boolean {
  return normalize(userAnswer) === normalize(correctWord);
}

export function getFuzzyStatus(userInput: string, correctWord: string): FuzzyStatus {
  if (!userInput.trim()) return 'empty';

  const input = normalize(userInput);
  const correct = normalize(correctWord);

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
export function generateDistractors(correctWord: string, pool: ClozeSentence[]): string[] {
  const correctNorm = normalize(correctWord);
  const correctLen = correctNorm.length;

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

  // Sort by length similarity to the correct word
  candidates.sort((a, b) => {
    const diffA = Math.abs(normalize(a).length - correctLen);
    const diffB = Math.abs(normalize(b).length - correctLen);
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

// --- Dictation scoring ------------------------------------------------------

// Compare what the user typed against the actual sentence at the word level.
// Words are matched on their normalized form (case- and punctuation-insensitive,
// per the issue) using a longest-common-subsequence alignment, so a dropped or
// inserted word shifts alignment instead of marking everything after it wrong.
// The returned tokens keep their original spelling for display.
export function diffDictation(typedRaw: string, actual: string): DictationDiff {
  const typedWords = typedRaw.trim().split(/\s+/).filter(Boolean);
  const actualWords = actual.trim().split(/\s+/).filter(Boolean);
  const t = typedWords.map(normalize);
  const a = actualWords.map(normalize);
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
