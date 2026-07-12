import { apiFetch } from './api-base';

export const APPROXIMATE_LEVELS = [
  'new',
  'beginner',
  'intermediate',
  'advanced',
  'not_sure',
] as const;

export type ApproximateLevel = (typeof APPROXIMATE_LEVELS)[number];

export const LEARNER_INTERESTS = [
  'everyday-life',
  'culture',
  'current-events',
  'literature',
  'faith-and-theology',
  'travel',
] as const;

export type LearnerInterest = (typeof LEARNER_INTERESTS)[number];
export type OnboardingStatus = 'in_progress' | 'completed' | 'skipped';
export type OnboardingStep = 'reader' | 'practice' | 'summary';

export type LearnerEventType =
  | 'onboarding.started'
  | 'onboarding.profile_saved'
  | 'onboarding.skipped'
  | 'lesson.opened'
  | 'reader.term_looked_up'
  | 'vocab.saved'
  | 'vocab.state_changed'
  | 'practice.answer_submitted'
  | 'practice.round_completed'
  | 'onboarding.completed';

export interface LearnerProfile {
  language: string;
  approximateLevel: ApproximateLevel;
  interests: LearnerInterest[];
  dailyMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingProgress {
  version: number;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  language: string;
  starterCollectionId: string | null;
  recommendedLessonId: string | null;
  recommendedLessonTitle: string | null;
  nextLessonId: string | null;
  nextLessonTitle: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface LearnerEvent {
  id: string;
  eventType: LearnerEventType;
  language: string;
  lessonId: string | null;
  vocabId: string | null;
  properties: Record<string, unknown>;
  occurredAt: string;
}

export interface OnboardingSnapshot {
  progress: OnboardingProgress | null;
  profile: LearnerProfile | null;
  events: LearnerEvent[];
}

export interface StartOnboardingInput {
  language: string;
  approximateLevel: ApproximateLevel;
  interests: LearnerInterest[];
  dailyMinutes: number;
  starterCollectionId?: string;
  recommendedLessonId?: string;
  recommendedLessonTitle?: string;
}

async function jsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error || fallback);
}

export async function getOnboardingSnapshot(): Promise<OnboardingSnapshot> {
  const response = await apiFetch('/api/onboarding');
  return jsonOrThrow<OnboardingSnapshot>(response, 'Could not load onboarding progress');
}

export async function startOnboarding(input: StartOnboardingInput): Promise<OnboardingSnapshot> {
  const response = await apiFetch('/api/onboarding/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<OnboardingSnapshot>(response, 'Could not start the guided session');
}

export async function skipOnboarding(
  input: Pick<StartOnboardingInput, 'language' | 'approximateLevel' | 'interests' | 'dailyMinutes'>,
): Promise<OnboardingSnapshot> {
  const response = await apiFetch('/api/onboarding/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<OnboardingSnapshot>(response, 'Could not skip the guided session');
}

export async function updateOnboardingProgress(input: {
  currentStep?: OnboardingStep;
  nextLessonId?: string | null;
  nextLessonTitle?: string | null;
}): Promise<OnboardingSnapshot> {
  const response = await apiFetch('/api/onboarding', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<OnboardingSnapshot>(response, 'Could not update onboarding progress');
}

export async function completeOnboarding(): Promise<OnboardingSnapshot> {
  const response = await apiFetch('/api/onboarding/complete', { method: 'POST' });
  return jsonOrThrow<OnboardingSnapshot>(response, 'Could not complete onboarding');
}

export async function recordLearnerEvent(input: {
  eventType: LearnerEventType;
  language: string;
  lessonId?: string;
  vocabId?: string;
  properties?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<{ recorded: boolean; event: LearnerEvent }> {
  const response = await apiFetch('/api/learner-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(response, 'Could not record learning activity');
}

export function onboardingEvents(snapshot: OnboardingSnapshot | null): LearnerEvent[] {
  if (!snapshot?.progress) return [];
  const startedAt = new Date(snapshot.progress.startedAt).getTime();
  return snapshot.events.filter((event) => {
    const properties = event.properties as { source?: unknown };
    return properties.source === 'onboarding' && new Date(event.occurredAt).getTime() >= startedAt;
  });
}

export function savedOnboardingWords(
  snapshot: OnboardingSnapshot | null,
): Array<{ id: string; text: string }> {
  const words = new Map<string, string>();
  for (const event of onboardingEvents(snapshot)) {
    if (event.eventType !== 'vocab.saved' || !event.vocabId) continue;
    const text = typeof event.properties.text === 'string' ? event.properties.text : '';
    if (text) words.set(event.vocabId, text);
  }
  return [...words].map(([id, text]) => ({ id, text }));
}

export function encounteredOnboardingTerms(snapshot: OnboardingSnapshot | null): string[] {
  const terms = new Set<string>();
  for (const event of onboardingEvents(snapshot)) {
    if (event.eventType !== 'reader.term_looked_up') continue;
    const term = typeof event.properties.term === 'string' ? event.properties.term : '';
    if (term) terms.add(term);
  }
  return [...terms];
}

export function hasOnboardingPhraseLookup(snapshot: OnboardingSnapshot | null): boolean {
  return onboardingEvents(snapshot).some((event) => {
    if (event.eventType !== 'reader.term_looked_up') return false;
    if (event.properties.kind === 'phrase') return true;
    const term = typeof event.properties.term === 'string' ? event.properties.term.trim() : '';
    return /\s/u.test(term);
  });
}
