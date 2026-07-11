import { Hono, type Context } from 'hono';
import {
  db,
  type LearnerEventRow,
  type LearnerProfileRow,
  type OnboardingProgressRow,
  type OnboardingStep,
} from '../db';
import { learnerEventResponse, recordLearnerEvent } from '../lib/learner-events';
import { getActiveLanguageCode } from '../lib/active-language';
import { isValidLanguageCode, type LanguageCode } from '../lib/languages';
import { getCurrentUserId } from '../lib/user';

const app = new Hono();

const APPROXIMATE_LEVELS = new Set(['new', 'beginner', 'intermediate', 'advanced', 'not_sure']);
const LEARNER_INTERESTS = new Set([
  'everyday-life',
  'culture',
  'current-events',
  'literature',
  'faith-and-theology',
  'travel',
]);
const ONBOARDING_STEPS = new Set<OnboardingStep>(['reader', 'practice', 'summary']);
const ONBOARDING_STEP_ORDER: Record<OnboardingStep, number> = {
  reader: 0,
  practice: 1,
  summary: 2,
};

class InputError extends Error {}

interface ProfileInput {
  language: LanguageCode;
  approximateLevel: LearnerProfileRow['approximateLevel'];
  interests: string[];
  dailyMinutes: number;
}

function requireShortString(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new InputError(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function optionalShortString(value: unknown, name: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireShortString(value, name);
}

function parseProfileInput(body: Record<string, unknown>): ProfileInput {
  if (typeof body.language !== 'string' || !isValidLanguageCode(body.language)) {
    throw new InputError('Invalid language');
  }
  if (typeof body.approximateLevel !== 'string' || !APPROXIMATE_LEVELS.has(body.approximateLevel)) {
    throw new InputError('Invalid approximateLevel');
  }
  if (!Array.isArray(body.interests) || body.interests.length > LEARNER_INTERESTS.size) {
    throw new InputError('interests must be an array of supported values');
  }
  if (
    body.interests.some(
      (interest) => typeof interest !== 'string' || !LEARNER_INTERESTS.has(interest),
    )
  ) {
    throw new InputError('interests contains an unsupported value');
  }
  const interests = [...new Set(body.interests as string[])];
  if (
    typeof body.dailyMinutes !== 'number' ||
    !Number.isInteger(body.dailyMinutes) ||
    body.dailyMinutes < 5 ||
    body.dailyMinutes > 120
  ) {
    throw new InputError('dailyMinutes must be an integer between 5 and 120');
  }

  return {
    language: body.language,
    approximateLevel: body.approximateLevel as LearnerProfileRow['approximateLevel'],
    interests,
    dailyMinutes: body.dailyMinutes,
  };
}

function profileResponse(row: LearnerProfileRow | undefined) {
  if (!row) return null;
  let interests: string[] = [];
  try {
    const parsed = JSON.parse(row.interests);
    if (Array.isArray(parsed)) interests = parsed.filter((value) => typeof value === 'string');
  } catch {
    // A hand-edited legacy value should degrade to no interests, not a 500.
  }
  return {
    language: row.language,
    approximateLevel: row.approximateLevel,
    interests,
    dailyMinutes: row.dailyMinutes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function progressResponse(row: OnboardingProgressRow | undefined) {
  if (!row) return null;
  return {
    version: row.version,
    status: row.status,
    currentStep: row.currentStep,
    language: row.language,
    starterCollectionId: row.starterCollectionId,
    recommendedLessonId: row.recommendedLessonId,
    recommendedLessonTitle: row.recommendedLessonTitle,
    nextLessonId: row.nextLessonId,
    nextLessonTitle: row.nextLessonTitle,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function buildSnapshot(userId: string) {
  const progress = db.prepare('SELECT * FROM onboarding_progress WHERE userId = ?').get(userId) as
    | OnboardingProgressRow
    | undefined;
  const profileLanguage = progress?.language ?? getActiveLanguageCode(userId);
  const profile = db
    .prepare('SELECT * FROM learner_profiles WHERE userId = ? AND language = ?')
    .get(userId, profileLanguage) as LearnerProfileRow | undefined;
  const events = progress
    ? (db
        .prepare(
          'SELECT * FROM learner_events WHERE userId = ? AND occurredAt >= ? ORDER BY occurredAt, rowid',
        )
        .all(userId, progress.startedAt) as LearnerEventRow[])
    : [];

  return {
    progress: progressResponse(progress),
    profile: profileResponse(profile),
    events: events.map(learnerEventResponse),
  };
}

function saveTargetLanguage(userId: string, language: LanguageCode) {
  db.prepare('INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
    userId,
    'targetLanguage',
    JSON.stringify(language),
  );
}

function saveProfile(userId: string, input: ProfileInput, now: string) {
  db.prepare(
    `INSERT INTO learner_profiles
       (userId, language, approximateLevel, interests, dailyMinutes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId, language) DO UPDATE SET
       approximateLevel = excluded.approximateLevel,
       interests = excluded.interests,
       dailyMinutes = excluded.dailyMinutes,
       updatedAt = excluded.updatedAt`,
  ).run(
    userId,
    input.language,
    input.approximateLevel,
    JSON.stringify(input.interests),
    input.dailyMinutes,
    now,
    now,
  );
}

function recordProfileSaved(userId: string, input: ProfileInput) {
  recordLearnerEvent(userId, {
    eventType: 'onboarding.profile_saved',
    language: input.language,
    properties: {
      source: 'onboarding',
      approximateLevel: input.approximateLevel,
      interests: input.interests,
      dailyMinutes: input.dailyMinutes,
    },
    idempotencyKey: 'onboarding:v1:profile_saved',
  });
}

function resolveRecommendation(
  userId: string,
  language: LanguageCode,
  body: Record<string, unknown>,
) {
  const requestedCollectionId = optionalShortString(
    body.starterCollectionId,
    'starterCollectionId',
  );
  const requestedLessonId = optionalShortString(body.recommendedLessonId, 'recommendedLessonId');
  optionalShortString(body.recommendedLessonTitle, 'recommendedLessonTitle');

  if (requestedCollectionId) {
    const collection = db
      .prepare('SELECT 1 FROM collections WHERE userId = ? AND id = ? AND language = ?')
      .get(userId, requestedCollectionId, language);
    if (!collection) throw new InputError('Starter collection not found');
  }

  const lesson = requestedLessonId
    ? (db
        .prepare(
          `SELECT id, title, collectionId FROM lessons
           WHERE userId = ? AND id = ? AND language = ?`,
        )
        .get(userId, requestedLessonId, language) as
        | { id: string; title: string; collectionId: string | null }
        | undefined)
    : requestedCollectionId
      ? (db
          .prepare(
            `SELECT id, title, collectionId FROM lessons
             WHERE userId = ? AND collectionId = ? AND language = ?
             ORDER BY sortOrder, createdAt LIMIT 1`,
          )
          .get(userId, requestedCollectionId, language) as
          | { id: string; title: string; collectionId: string | null }
          | undefined)
      : undefined;

  if (requestedLessonId && !lesson) throw new InputError('Recommended lesson not found');
  if (lesson && requestedCollectionId && lesson.collectionId !== requestedCollectionId) {
    throw new InputError('Recommended lesson does not belong to the starter collection');
  }

  return {
    starterCollectionId: requestedCollectionId ?? null,
    recommendedLessonId: lesson?.id ?? null,
    recommendedLessonTitle: lesson?.title ?? null,
  };
}

async function readBody(c: Context) {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) throw new InputError('Invalid JSON body');
  return body;
}

// A legacy user may already have targetLanguage but no onboarding row. Do not
// synthesize one here: the client treats that exact shape as the existing-user
// bypass, while a genuinely fresh user explicitly starts or skips v1.
app.get('/', (c) => c.json(buildSnapshot(getCurrentUserId(c))));

app.post('/start', async (c) => {
  const userId = getCurrentUserId(c);
  try {
    const body = await readBody(c);
    const input = parseProfileInput(body);
    const existing = db
      .prepare('SELECT * FROM onboarding_progress WHERE userId = ?')
      .get(userId) as OnboardingProgressRow | undefined;
    if (existing && existing.status !== 'in_progress') return c.json(buildSnapshot(userId));

    const recommendation = resolveRecommendation(userId, input.language, body);
    const now = new Date().toISOString();
    db.transaction(() => {
      saveTargetLanguage(userId, input.language);
      saveProfile(userId, input, now);
      if (!existing) {
        db.prepare(
          `INSERT INTO onboarding_progress
             (userId, version, status, currentStep, language, starterCollectionId,
              recommendedLessonId, recommendedLessonTitle, startedAt, updatedAt)
           VALUES (?, 1, 'in_progress', 'reader', ?, ?, ?, ?, ?, ?)`,
        ).run(
          userId,
          input.language,
          recommendation.starterCollectionId,
          recommendation.recommendedLessonId,
          recommendation.recommendedLessonTitle,
          now,
          now,
        );
      } else {
        db.prepare(
          `UPDATE onboarding_progress SET
             language = ?, starterCollectionId = ?, recommendedLessonId = ?,
             recommendedLessonTitle = ?, updatedAt = ?
           WHERE userId = ?`,
        ).run(
          input.language,
          recommendation.starterCollectionId ?? existing.starterCollectionId,
          recommendation.recommendedLessonId ?? existing.recommendedLessonId,
          recommendation.recommendedLessonTitle ?? existing.recommendedLessonTitle,
          now,
          userId,
        );
      }
      recordLearnerEvent(userId, {
        eventType: 'onboarding.started',
        language: input.language,
        properties: { source: 'onboarding' },
        idempotencyKey: 'onboarding:v1:started',
      });
      recordProfileSaved(userId, input);
    })();
    return c.json(buildSnapshot(userId));
  } catch (error) {
    if (error instanceof InputError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.post('/skip', async (c) => {
  const userId = getCurrentUserId(c);
  try {
    const body = await readBody(c);
    const input = parseProfileInput(body);
    const existing = db
      .prepare('SELECT * FROM onboarding_progress WHERE userId = ?')
      .get(userId) as OnboardingProgressRow | undefined;
    if (existing && existing.status !== 'in_progress') return c.json(buildSnapshot(userId));

    const now = new Date().toISOString();
    db.transaction(() => {
      saveTargetLanguage(userId, input.language);
      saveProfile(userId, input, now);
      if (existing) {
        db.prepare(
          `UPDATE onboarding_progress SET status = 'skipped', currentStep = 'summary',
             language = ?, completedAt = ?, updatedAt = ? WHERE userId = ?`,
        ).run(input.language, now, now, userId);
      } else {
        db.prepare(
          `INSERT INTO onboarding_progress
             (userId, version, status, currentStep, language, startedAt, completedAt, updatedAt)
           VALUES (?, 1, 'skipped', 'summary', ?, ?, ?, ?)`,
        ).run(userId, input.language, now, now, now);
      }
      recordProfileSaved(userId, input);
      recordLearnerEvent(userId, {
        eventType: 'onboarding.skipped',
        language: input.language,
        properties: { source: 'onboarding' },
        idempotencyKey: 'onboarding:v1:skipped',
      });
    })();
    return c.json(buildSnapshot(userId));
  } catch (error) {
    if (error instanceof InputError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.patch('/', async (c) => {
  const userId = getCurrentUserId(c);
  try {
    const body = await readBody(c);
    const existing = db
      .prepare('SELECT * FROM onboarding_progress WHERE userId = ?')
      .get(userId) as OnboardingProgressRow | undefined;
    if (!existing) return c.json({ error: 'Onboarding has not started' }, 409);
    if (existing.status !== 'in_progress') return c.json(buildSnapshot(userId));

    const requestedStep =
      body.currentStep === undefined
        ? undefined
        : typeof body.currentStep === 'string' &&
            ONBOARDING_STEPS.has(body.currentStep as OnboardingStep)
          ? (body.currentStep as OnboardingStep)
          : null;
    if (requestedStep === null) throw new InputError('Invalid currentStep');

    // Reader mounts can race with, or happen after, advancing to practice.
    // Persist the furthest reached step so a stale reader update cannot send a
    // cross-device resume card backwards through the learning loop.
    const currentStep =
      requestedStep === undefined ||
      ONBOARDING_STEP_ORDER[requestedStep] < ONBOARDING_STEP_ORDER[existing.currentStep]
        ? existing.currentStep
        : requestedStep;

    let nextLessonId: string | null =
      body.nextLessonId === undefined
        ? existing.nextLessonId
        : (optionalShortString(body.nextLessonId, 'nextLessonId') ?? null);
    let nextLessonTitle = existing.nextLessonTitle;
    if (nextLessonId) {
      const lesson = db
        .prepare('SELECT title FROM lessons WHERE userId = ? AND id = ? AND language = ?')
        .get(userId, nextLessonId, existing.language) as { title: string } | undefined;
      if (!lesson) throw new InputError('Next lesson not found');
      nextLessonTitle = lesson.title;
    } else if (body.nextLessonId === null) {
      nextLessonId = null;
      nextLessonTitle = null;
    } else if (body.nextLessonTitle !== undefined) {
      throw new InputError('nextLessonTitle requires nextLessonId');
    }

    if (
      body.currentStep === undefined &&
      body.nextLessonId === undefined &&
      body.nextLessonTitle === undefined
    ) {
      throw new InputError('No onboarding progress fields supplied');
    }

    db.prepare(
      `UPDATE onboarding_progress SET currentStep = ?, nextLessonId = ?, nextLessonTitle = ?,
       updatedAt = ? WHERE userId = ?`,
    ).run(currentStep, nextLessonId, nextLessonTitle, new Date().toISOString(), userId);
    return c.json(buildSnapshot(userId));
  } catch (error) {
    if (error instanceof InputError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.post('/complete', (c) => {
  const userId = getCurrentUserId(c);
  const existing = db.prepare('SELECT * FROM onboarding_progress WHERE userId = ?').get(userId) as
    | OnboardingProgressRow
    | undefined;
  if (!existing) return c.json({ error: 'Onboarding has not started' }, 409);
  if (existing.status !== 'in_progress') return c.json(buildSnapshot(userId));

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE onboarding_progress SET status = 'completed', currentStep = 'summary',
       completedAt = ?, updatedAt = ? WHERE userId = ?`,
    ).run(now, now, userId);
    recordLearnerEvent(userId, {
      eventType: 'onboarding.completed',
      language: existing.language,
      properties: { source: 'onboarding' },
      idempotencyKey: 'onboarding:v1:completed',
    });
  })();
  return c.json(buildSnapshot(userId));
});

export default app;
