import { describe, expect, it, vi } from 'vitest';
import type { ClozeSentence } from '@/types';
import {
  clozeRoundReducer,
  commitRoundReview,
  createInitialRoundState,
  type ClozeRoundState,
} from '../use-cloze-round';

function sentence(id: string, masteryLevel = 25): ClozeSentence {
  return {
    id,
    sentence: `Die ${id} slaap.`,
    clozeWord: id,
    clozeIndex: 1,
    masteryLevel,
  } as ClozeSentence;
}

function start(sentences: ClozeSentence[], size = sentences.length): ClozeRoundState {
  const loading = clozeRoundReducer(createInitialRoundState(10), { type: 'begin', size });
  return clozeRoundReducer(loading, { type: 'start', sentences });
}

describe('useClozeRound state controller', () => {
  it('starts a round with a derived current sentence and reset counters', () => {
    const state = start([sentence('kat'), sentence('hond')]);

    expect(state.phase).toBe('practicing');
    expect(state.current).toEqual({
      sentence: expect.objectContaining({ id: 'kat' }),
      blankedSentence: 'Die _____ slaap.',
    });
    expect(state.roundSize).toBe(2);
    expect(state.roundProgress).toBe(0);
    expect(state.retryQueue).toEqual([]);
    expect(state.points).toBe(10);
  });

  it('counts first-pass answers and carries misses into a demoted retry phase', () => {
    let state = start([sentence('kat', 50), sentence('hond', 50)]);
    state = clozeRoundReducer(state, {
      type: 'review-committed',
      isCorrect: false,
      earnedPoints: 0,
      newMastery: 0,
    });

    expect(state.roundProgress).toBe(1);
    expect(state.roundCorrect).toBe(0);
    expect(state.retryQueue[0]).toMatchObject({ id: 'kat', masteryLevel: 0 });

    state = clozeRoundReducer(state, { type: 'advance' });
    expect(state.current?.sentence.id).toBe('hond');
    state = clozeRoundReducer(state, {
      type: 'review-committed',
      isCorrect: true,
      earnedPoints: 8,
      newMastery: 75,
    });
    state = clozeRoundReducer(state, { type: 'advance' });

    expect(state.isRetryPhase).toBe(true);
    expect(state.current?.sentence).toMatchObject({ id: 'kat', masteryLevel: 0 });
    expect(state.roundProgress).toBe(2);
    expect(state.roundCorrect).toBe(1);
    expect(state.points).toBe(18);
  });

  it('does not increase progress or correctness for retry answers', () => {
    let state = start([sentence('kat')]);
    state = clozeRoundReducer(state, {
      type: 'review-committed',
      isCorrect: false,
      earnedPoints: 0,
      newMastery: 0,
    });
    state = clozeRoundReducer(state, { type: 'advance' });
    state = clozeRoundReducer(state, {
      type: 'review-committed',
      isCorrect: true,
      earnedPoints: 0,
      newMastery: 25,
    });
    state = clozeRoundReducer(state, { type: 'advance' });

    expect(state.phase).toBe('complete');
    expect(state.roundProgress).toBe(1);
    expect(state.roundCorrect).toBe(0);
  });

  it('skips a blacklisted card, reduces the target, and keeps the next card current', () => {
    const state = clozeRoundReducer(start([sentence('kat'), sentence('hond')]), {
      type: 'blacklist-current',
    });

    expect(state.roundSize).toBe(1);
    expect(state.current?.sentence.id).toBe('hond');
    expect(state.queue.map((item) => item.id)).toEqual(['hond']);
  });

  it('persists before producing the state transition and returns no action on failure', async () => {
    const state = start([sentence('kat')]);
    const failedSave = vi.fn().mockResolvedValue(false);
    const successfulSave = vi.fn().mockResolvedValue(true);
    const result = { isCorrect: true, earnedPoints: 8, newMastery: 50 as const };

    await expect(commitRoundReview(state, result, failedSave)).resolves.toBeNull();
    await expect(commitRoundReview(state, result, successfulSave)).resolves.toEqual({
      type: 'review-committed',
      ...result,
    });
    expect(failedSave).toHaveBeenCalledWith('kat', 'kat', true, 8, 50, expect.any(Date));
  });
});
