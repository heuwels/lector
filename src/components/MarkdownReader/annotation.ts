import type { WordState } from '@/types';

/**
 * How much of the pronunciation layer the reader prints above the words
 * (#289 4.4).
 *
 *   off      no ruby at all — the plain text the reader always had.
 *   learning only words the learner has not finished. Pinyin fades away as
 *            each word reaches 'known', which is the point of the feature.
 *   all      every word that has a reading.
 *
 * 'learning' is the default for a pack that declares an annotation source. A
 * Chinese sentence with no readings is unreadable to a beginner, so 'off' is a
 * poor first impression, and 'all' keeps printing pinyin over words the learner
 * already reads without it.
 */
export type AnnotationMode = 'off' | 'learning' | 'all';

export const ANNOTATION_MODES: readonly AnnotationMode[] = ['off', 'learning', 'all'];

export const ANNOTATION_MODE_LABELS: Record<AnnotationMode, string> = {
  off: 'Off',
  learning: 'Learning words',
  all: 'All words',
};

// A word the learner has finished with. 'ignored' counts: the learner marked it
// as not worth studying, so printing a reading over it adds noise.
const SETTLED_STATES = new Set<WordState>(['known', 'ignored']);

/**
 * The reading to print above one word, or undefined for none.
 *
 * Takes the FOLDED word, because that is the key the readings map is built
 * with and the same key the caller already computed for the word's state.
 */
export function wordReading(
  mode: AnnotationMode,
  readings: Map<string, string> | null,
  foldedWord: string,
  state: WordState | undefined,
): string | undefined {
  if (mode === 'off' || !readings) return undefined;
  if (mode === 'learning' && state && SETTLED_STATES.has(state)) return undefined;
  return readings.get(foldedWord);
}
