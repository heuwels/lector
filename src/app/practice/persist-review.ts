import { toast } from 'sonner';
import {
  updateClozeAfterReview,
  updateWordState,
  incrementDailyStat,
  type ClozeMasteryLevel,
} from '@/lib/data-layer';
import { splitTrailingPunctuation } from '@/lib/words';

/**
 * Persist one graded practice answer (#232).
 *
 * The clozeSentences review row is the source of truth: if that write fails,
 * nothing may advance — no points, no round progress, no feedback screen
 * claiming success — so this returns false and surfaces the error. The
 * word-state and daily-stat writes are best-effort: the review is saved, the
 * round can continue, but the learner is told their stats didn't update.
 */
export async function persistReview(
  sentenceId: string,
  clozeWord: string,
  isCorrect: boolean,
  earnedPoints: number,
  newMastery: ClozeMasteryLevel,
  nextReview: Date,
): Promise<boolean> {
  const saved = await updateClozeAfterReview(sentenceId, isCorrect, newMastery, nextReview);
  if (!saved) {
    toast.error('Could not save your answer — check your connection and try again.');
    return false;
  }

  let secondaryOk = true;
  if (newMastery === 100) {
    // Strip trailing punctuation so the reader's known-word lookup (clean,
    // lowercased tokens) matches and fluency stats don't double-count.
    secondaryOk = await updateWordState(splitTrailingPunctuation(clozeWord)[0], 'known');
  }
  secondaryOk = (await incrementDailyStat('clozePracticed')) && secondaryOk;
  if (earnedPoints > 0) {
    secondaryOk = (await incrementDailyStat('points', earnedPoints)) && secondaryOk;
  }
  if (!secondaryOk) {
    toast.error('Your answer was saved, but updating your stats failed.');
  }

  return true;
}
