import { randomUUID } from 'crypto';
import { db, type LearnerEventRow } from '../db';
import type { LanguageCode } from './languages';

export const LEARNER_EVENT_TYPES = [
  'onboarding.started',
  'onboarding.profile_saved',
  'onboarding.skipped',
  'lesson.opened',
  'reader.term_looked_up',
  'vocab.saved',
  'vocab.state_changed',
  'practice.answer_submitted',
  'practice.round_completed',
  'onboarding.completed',
] as const;

export type LearnerEventType = (typeof LEARNER_EVENT_TYPES)[number];

export interface LearnerEventInput {
  eventType: LearnerEventType;
  language: LanguageCode;
  lessonId?: string | null;
  vocabId?: string | null;
  properties?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export function learnerEventResponse(row: LearnerEventRow) {
  let properties: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.properties);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) properties = parsed;
  } catch {
    // A hand-edited/legacy row must not make the whole onboarding snapshot fail.
  }

  return {
    id: row.id,
    eventType: row.eventType,
    language: row.language,
    lessonId: row.lessonId,
    vocabId: row.vocabId,
    properties,
    occurredAt: row.occurredAt,
  };
}

/**
 * Append one learner event, deduplicating retries when the caller supplies an
 * idempotency key. The partial unique index is the final race guard; the
 * read-first path lets us return the original event without manufacturing a
 * second timestamp or id.
 */
export function recordLearnerEvent(userId: string, input: LearnerEventInput) {
  if (input.idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM learner_events WHERE userId = ? AND idempotencyKey = ?')
      .get(userId, input.idempotencyKey) as LearnerEventRow | undefined;
    if (existing) return { recorded: false, event: learnerEventResponse(existing) };
  }

  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO learner_events
       (userId, id, eventType, language, lessonId, vocabId, properties, idempotencyKey, occurredAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      id,
      input.eventType,
      input.language,
      input.lessonId ?? null,
      input.vocabId ?? null,
      JSON.stringify(input.properties ?? {}),
      input.idempotencyKey ?? null,
      occurredAt,
    );

  const row = (
    result.changes > 0
      ? db.prepare('SELECT * FROM learner_events WHERE userId = ? AND id = ?').get(userId, id)
      : db
          .prepare('SELECT * FROM learner_events WHERE userId = ? AND idempotencyKey = ?')
          .get(userId, input.idempotencyKey ?? '')
  ) as LearnerEventRow;

  return { recorded: result.changes > 0, event: learnerEventResponse(row) };
}
