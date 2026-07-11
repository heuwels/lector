import { describe, expect, it } from 'vitest';
import {
  encounteredOnboardingTerms,
  onboardingEvents,
  savedOnboardingWords,
  type LearnerEvent,
  type OnboardingSnapshot,
} from './onboarding';

const STARTED = '2026-07-11T10:00:00.000Z';

function event(
  eventType: LearnerEvent['eventType'],
  overrides: Partial<LearnerEvent> = {},
): LearnerEvent {
  return {
    id: crypto.randomUUID(),
    eventType,
    language: 'es',
    lessonId: 'lesson-1',
    vocabId: null,
    properties: { source: 'onboarding' },
    occurredAt: '2026-07-11T10:05:00.000Z',
    ...overrides,
  };
}

function snapshot(events: LearnerEvent[]): OnboardingSnapshot {
  return {
    progress: {
      version: 1,
      status: 'in_progress',
      currentStep: 'reader',
      language: 'es',
      starterCollectionId: 'starter-es',
      recommendedLessonId: 'lesson-1',
      recommendedLessonTitle: 'Hola',
      nextLessonId: 'lesson-2',
      nextLessonTitle: 'La casa',
      startedAt: STARTED,
      completedAt: null,
      updatedAt: STARTED,
    },
    profile: null,
    events,
  };
}

describe('onboarding event derivation', () => {
  it('keeps only events from the active onboarding run', () => {
    const current = event('lesson.opened');
    const unrelated = event('lesson.opened', { properties: { source: 'reader' } });
    const old = event('lesson.opened', { occurredAt: '2026-07-10T10:00:00.000Z' });

    expect(onboardingEvents(snapshot([current, unrelated, old]))).toEqual([current]);
  });

  it('deduplicates saved words by vocab id while keeping their latest text', () => {
    const first = event('vocab.saved', {
      vocabId: 'v1',
      properties: { source: 'onboarding', text: 'hola' },
    });
    const repeated = event('vocab.saved', {
      vocabId: 'v1',
      properties: { source: 'onboarding', text: 'Hola' },
    });
    const second = event('vocab.saved', {
      vocabId: 'v2',
      properties: { source: 'onboarding', text: 'casa' },
    });

    expect(savedOnboardingWords(snapshot([first, repeated, second]))).toEqual([
      { id: 'v1', text: 'Hola' },
      { id: 'v2', text: 'casa' },
    ]);
  });

  it('counts each encountered term once', () => {
    const hola = event('reader.term_looked_up', {
      properties: { source: 'onboarding', term: 'Hola' },
    });
    const holaAgain = event('reader.term_looked_up', {
      properties: { source: 'onboarding', term: 'Hola' },
    });
    const casa = event('reader.term_looked_up', {
      properties: { source: 'onboarding', term: 'casa' },
    });

    expect(encounteredOnboardingTerms(snapshot([hola, holaAgain, casa]))).toEqual(['Hola', 'casa']);
  });
});
