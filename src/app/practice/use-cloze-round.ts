import { useCallback, useReducer } from 'react';
import type { ClozeMasteryLevel, ClozeSentence } from '@/types';
import { persistReview } from './persist-review';
import type { CurrentSentence, PracticeState } from './types';
import { calculateNextReview, createBlankedSentence } from './utils';

export interface ClozeRoundState {
  phase: PracticeState;
  queue: ClozeSentence[];
  current: CurrentSentence | null;
  roundSize: number;
  roundProgress: number;
  roundCorrect: number;
  points: number;
  retryQueue: ClozeSentence[];
  isRetryPhase: boolean;
}

interface ReviewResult {
  isCorrect: boolean;
  earnedPoints: number;
  newMastery: ClozeMasteryLevel;
}

export type ClozeRoundAction =
  | { type: 'set-phase'; phase: PracticeState }
  | { type: 'set-points'; points: number }
  | { type: 'set-size'; size: number }
  | { type: 'begin'; size: number }
  | { type: 'start'; sentences: ClozeSentence[] }
  | ({ type: 'review-committed' } & ReviewResult)
  | { type: 'show-feedback' }
  | { type: 'advance' }
  | { type: 'blacklist-current' };

type SaveReview = typeof persistReview;

function currentFrom(sentences: ClozeSentence[]): CurrentSentence | null {
  const sentence = sentences[0];
  if (!sentence) return null;
  return {
    sentence,
    blankedSentence: createBlankedSentence(sentence.sentence, sentence.clozeIndex),
  };
}

export function createInitialRoundState(points = 0): ClozeRoundState {
  return {
    phase: 'setup',
    queue: [],
    current: null,
    roundSize: 20,
    roundProgress: 0,
    roundCorrect: 0,
    points,
    retryQueue: [],
    isRetryPhase: false,
  };
}

function advanceRound(state: ClozeRoundState): ClozeRoundState {
  const remaining = state.queue.slice(1);
  if (remaining.length > 0) {
    return {
      ...state,
      phase: 'practicing',
      queue: remaining,
      current: currentFrom(remaining),
    };
  }

  if (state.retryQueue.length > 0) {
    const retries = [...state.retryQueue];
    return {
      ...state,
      phase: 'practicing',
      queue: retries,
      current: currentFrom(retries),
      retryQueue: [],
      isRetryPhase: true,
    };
  }

  return { ...state, phase: 'complete', queue: [], current: null };
}

export function clozeRoundReducer(
  state: ClozeRoundState,
  action: ClozeRoundAction,
): ClozeRoundState {
  switch (action.type) {
    case 'set-phase':
      return { ...state, phase: action.phase };
    case 'set-points':
      return { ...state, points: action.points };
    case 'set-size':
      return { ...state, roundSize: action.size };
    case 'begin':
      return {
        ...state,
        phase: 'loading',
        queue: [],
        current: null,
        roundSize: action.size,
        roundProgress: 0,
        roundCorrect: 0,
        retryQueue: [],
        isRetryPhase: false,
      };
    case 'start':
      return {
        ...state,
        phase: action.sentences.length > 0 ? 'practicing' : 'empty',
        queue: action.sentences,
        current: currentFrom(action.sentences),
      };
    case 'review-committed': {
      if (!state.current) return state;
      const firstPass = !state.isRetryPhase;
      const retryQueue = action.isCorrect
        ? state.retryQueue
        : [
            ...state.retryQueue,
            { ...state.current.sentence, masteryLevel: 0 as ClozeMasteryLevel },
          ];
      return {
        ...state,
        roundProgress: state.roundProgress + (firstPass ? 1 : 0),
        roundCorrect: state.roundCorrect + (firstPass && action.isCorrect ? 1 : 0),
        points: state.points + Math.max(0, action.earnedPoints),
        retryQueue,
      };
    }
    case 'show-feedback':
      return { ...state, phase: 'feedback' };
    case 'advance':
      return advanceRound(state);
    case 'blacklist-current':
      return advanceRound({ ...state, roundSize: Math.max(0, state.roundSize - 1) });
  }
}

export async function commitRoundReview(
  state: ClozeRoundState,
  result: ReviewResult,
  saveReview: SaveReview = persistReview,
): Promise<ClozeRoundAction | null> {
  if (!state.current) return null;

  const saved = await saveReview(
    state.current.sentence.id,
    state.current.sentence.clozeWord,
    result.isCorrect,
    result.earnedPoints,
    result.newMastery,
    calculateNextReview(result.newMastery),
  );
  if (!saved) return null;

  return { type: 'review-committed', ...result };
}

export function useClozeRound() {
  const [round, dispatch] = useReducer(clozeRoundReducer, undefined, () =>
    createInitialRoundState(),
  );

  const setPhase = useCallback((phase: PracticeState) => {
    dispatch({ type: 'set-phase', phase });
  }, []);

  const setPoints = useCallback((points: number) => {
    dispatch({ type: 'set-points', points });
  }, []);

  const setRoundSize = useCallback((size: number) => {
    dispatch({ type: 'set-size', size });
  }, []);

  const beginRound = useCallback((size: number) => {
    dispatch({ type: 'begin', size });
  }, []);

  const startRound = useCallback((sentences: ClozeSentence[]) => {
    dispatch({ type: 'start', sentences });
    return currentFrom(sentences);
  }, []);

  const commitReview = useCallback(
    async (result: ReviewResult) => {
      const action = await commitRoundReview(round, result);
      if (!action) return false;
      dispatch(action);
      return true;
    },
    [round],
  );

  const showFeedback = useCallback(() => {
    dispatch({ type: 'show-feedback' });
  }, []);

  const advance = useCallback(() => {
    const action = { type: 'advance' } as const;
    const next = clozeRoundReducer(round, action);
    dispatch(action);
    return next;
  }, [round]);

  const blacklistCurrent = useCallback(() => {
    const action = { type: 'blacklist-current' } as const;
    const next = clozeRoundReducer(round, action);
    dispatch(action);
    return next;
  }, [round]);

  return {
    ...round,
    setPhase,
    setPoints,
    setRoundSize,
    beginRound,
    startRound,
    commitReview,
    showFeedback,
    advance,
    blacklistCurrent,
  };
}
