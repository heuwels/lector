import type { ClozeMasteryLevel, ClozeSentence } from '@/types';
import { ROUND_SIZES } from './constants';

// Fuzzy match status for live feedback
export type FuzzyStatus = 'empty' | 'match' | 'partial' | 'wrong';
export type PracticeState = 'setup' | 'loading' | 'practicing' | 'feedback' | 'complete' | 'empty';
export type PracticeMode = 'type' | 'mc';

// Top-level practice format. Cloze (fill in the blanked word — Type/MC) vs
// Dictation (hear the whole sentence, type it back). Both draw from the same
// clozeSentences pool and share the SRS card, so the only difference is how the
// sentence is presented and answered.
export type PracticeFormat = 'cloze' | 'dictation';

export type RoundSize = (typeof ROUND_SIZES)[number];
export type RoundType = 'new' | 'review';

export interface IFeedbackData {
  isCorrect: boolean;
  correctWord: string;
  userAnswer: string;
  translation: string;
  points: number;
  newMastery: ClozeMasteryLevel;
  previousMastery: ClozeMasteryLevel;
}

export interface CurrentSentence {
  sentence: ClozeSentence;
  blankedSentence: string;
}

// One word in a dictation diff, with how it lined up against the other side.
// For the actual sentence: 'correct' (the user produced it) or 'missing'.
// For what the user typed: 'correct' (it matched the sequence) or 'wrong'.
export type DictationWordStatus = 'correct' | 'wrong' | 'missing';

export interface DictationWord {
  text: string; // the original word, shown as-is (case/punctuation preserved)
  status: DictationWordStatus;
}

// Word-level diff between what the user typed and the actual sentence, computed
// by a longest-common-subsequence alignment so reorderings, extra words and
// dropped words are scored sensibly rather than cascading.
export interface DictationDiff {
  expected: DictationWord[]; // the actual sentence, each word correct|missing
  typed: DictationWord[]; // what the user typed, each word correct|wrong
  correctWords: number; // words matched in order (the LCS length)
  totalWords: number; // words in the actual sentence
  accuracy: number; // correctWords / totalWords, 0..1
}

// The graded outcome of a dictation attempt — what the feedback screen renders
// and what drives the shared SRS update.
export interface DictationResult {
  diff: DictationDiff;
  typedRaw: string; // exactly what the user submitted
  isPass: boolean; // accuracy ≥ threshold → advances mastery (SRS "correct")
  isPerfect: boolean; // every word right, nothing extra
  surrendered: boolean; // user gave up and revealed the answer (always a miss)
  points: number;
  newMastery: ClozeMasteryLevel;
  previousMastery: ClozeMasteryLevel;
}
