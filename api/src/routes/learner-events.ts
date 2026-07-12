import { Hono } from 'hono';
import { db } from '../db';
import {
  LEARNER_EVENT_TYPES,
  MAX_LEARNER_EVENT_PROPERTIES_BYTES,
  recordLearnerEvent,
  type LearnerEventInput,
  type LearnerEventType,
} from '../lib/learner-events';
import { planLimitResponse } from '../lib/entitlements';
import { isValidLanguageCode, type LanguageCode } from '../lib/languages';
import { utf8Bytes } from '../lib/storage-limits';
import { getCurrentUserId } from '../lib/user';

const app = new Hono();
const eventTypes = new Set<string>(LEARNER_EVENT_TYPES);

function optionalId(value: unknown, name: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error(`${name} must be a non-empty string of at most 200 characters`);
  }
  return value;
}

app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return c.json({ error: 'Invalid JSON body' }, 400);

  if (typeof body.eventType !== 'string' || !eventTypes.has(body.eventType)) {
    return c.json({ error: 'Invalid eventType' }, 400);
  }
  if (typeof body.language !== 'string' || !isValidLanguageCode(body.language)) {
    return c.json({ error: 'Invalid language' }, 400);
  }

  let lessonId: string | null | undefined;
  let vocabId: string | null | undefined;
  let idempotencyKey: string | null | undefined;
  try {
    lessonId = optionalId(body.lessonId, 'lessonId');
    vocabId = optionalId(body.vocabId, 'vocabId');
    idempotencyKey = optionalId(body.idempotencyKey, 'idempotencyKey');
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }

  if (body.eventType === 'lesson.opened' && !lessonId) {
    return c.json({ error: 'lesson.opened requires lessonId' }, 400);
  }
  if ((body.eventType === 'vocab.saved' || body.eventType === 'vocab.state_changed') && !vocabId) {
    return c.json({ error: `${body.eventType} requires vocabId` }, 400);
  }

  const language = body.language as LanguageCode;
  if (
    lessonId &&
    !db
      .prepare('SELECT 1 FROM lessons WHERE userId = ? AND id = ? AND language = ?')
      .get(userId, lessonId, language)
  ) {
    return c.json({ error: 'Lesson not found' }, 404);
  }
  if (
    vocabId &&
    !db
      .prepare('SELECT 1 FROM vocab WHERE userId = ? AND id = ? AND language = ?')
      .get(userId, vocabId, language)
  ) {
    return c.json({ error: 'Vocabulary entry not found' }, 404);
  }

  const properties = body.properties ?? {};
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return c.json({ error: 'properties must be an object' }, 400);
  }
  if (utf8Bytes(JSON.stringify(properties)) > MAX_LEARNER_EVENT_PROPERTIES_BYTES) {
    return c.json({ error: 'properties is too large' }, 400);
  }

  const result = recordLearnerEvent(userId, {
    eventType: body.eventType as LearnerEventType,
    language,
    lessonId,
    vocabId,
    properties: properties as Record<string, unknown>,
    idempotencyKey,
  } satisfies LearnerEventInput);
  if ('limit' in result && result.limit) return planLimitResponse(c, result.limit);
  return c.json(result, result.recorded ? 201 : 200);
});

export default app;
