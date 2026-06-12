import { splitTrailingPunctuation } from '@/lib/words';
import { ClozeMasteryLevel, ClozeSentence } from '@/types';
import { FuzzyStatus } from './types';

// Helper export function to create blanked sentence, moving punctuation outside the blank
export function createBlankedSentence(sentence: string, wordIndex: number): string {
  const words = sentence.split(/\s+/);
  const [, punct] = splitTrailingPunctuation(words[wordIndex]);
  words[wordIndex] = '_____' + punct;
  return words.join(' ');
}

// Helper export function to normalize text for comparison
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'")\]]/g, '').trim();
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

// Calculate points for correct answer
export function calculatePoints(mastery: ClozeMasteryLevel): number {
  const pointsMap: Record<ClozeMasteryLevel, number> = {
    0: 10,
    25: 15,
    50: 20,
    75: 25,
    100: 30,
  };
  return pointsMap[mastery];
}

// Generate distractors from the queue/pool of cloze words
export function generateDistractors(
  correctWord: string,
  pool: ClozeSentence[],
): string[] {
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
