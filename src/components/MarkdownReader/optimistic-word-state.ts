import type { WordState } from '@/types';

export interface WordStatePatch {
  map: Map<string, WordState>;
  rollback: (current: Map<string, WordState>) => Map<string, WordState>;
}

/**
 * Patch one already-folded word key and return a guarded rollback. The guard
 * prevents an older failed request from undoing a newer state choice.
 */
export function patchWordState(
  current: Map<string, WordState>,
  word: string,
  state: WordState,
): WordStatePatch {
  const hadPrevious = current.has(word);
  const previous = current.get(word);
  const map = new Map(current);
  map.set(word, state);

  return {
    map,
    rollback(latest) {
      if (latest.get(word) !== state) return latest;
      const restored = new Map(latest);
      if (hadPrevious && previous) restored.set(word, previous);
      else restored.delete(word);
      return restored;
    },
  };
}
