import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';

const { default: onboarding } = await import('./onboarding');
const { default: learnerEvents } = await import('./learner-events');

const TS = '2026-01-01T00:00:00.000Z';
const profile = {
  language: 'es',
  approximateLevel: 'beginner',
  interests: ['culture', 'travel'],
  dailyMinutes: 15,
};

interface TestSnapshot {
  progress: {
    version: number;
    status: string;
    currentStep: string;
    language: string;
    starterCollectionId: string | null;
    recommendedLessonId: string | null;
    recommendedLessonTitle: string | null;
    nextLessonId: string | null;
    nextLessonTitle: string | null;
    startedAt: string;
    completedAt: string | null;
  };
  profile: {
    language: string;
    approximateLevel: string;
    interests: string[];
    dailyMinutes: number;
  };
  events: Array<{ id: string; eventType: string }>;
}

interface TestEventResult {
  recorded: boolean;
  event: {
    id: string;
    eventType: string;
    lessonId: string | null;
    vocabId: string | null;
    properties: Record<string, unknown>;
  };
}

function reset() {
  db.prepare('DELETE FROM learner_events').run();
  db.prepare('DELETE FROM onboarding_progress').run();
  db.prepare('DELETE FROM learner_profiles').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
  db.prepare("DELETE FROM lessons WHERE id LIKE 'onboard-%'").run();
  db.prepare("DELETE FROM collections WHERE id LIKE 'onboard-%'").run();
  db.prepare("DELETE FROM vocab WHERE id LIKE 'onboard-%'").run();
}

function seedLesson() {
  db.prepare(
    `INSERT INTO collections (userId, id, title, author, language, createdAt, lastReadAt)
     VALUES ('local', 'onboard-collection', 'Primeras historias', 'Lector', 'es', ?, ?)`,
  ).run(TS, TS);
  db.prepare(
    `INSERT INTO lessons
       (userId, id, collectionId, title, textContent, language, createdAt, lastReadAt)
     VALUES ('local', 'onboard-lesson-1', 'onboard-collection', 'Hola', 'Hola mundo.', 'es', ?, ?)`,
  ).run(TS, TS);
  db.prepare(
    `INSERT INTO lessons
       (userId, id, collectionId, title, sortOrder, textContent, language, createdAt, lastReadAt)
     VALUES ('local', 'onboard-lesson-2', 'onboard-collection', 'Mañana', 1, 'Hasta mañana.', 'es', ?, ?)`,
  ).run(TS, TS);
}

function post(app: typeof onboarding, path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('guided onboarding state', () => {
  beforeEach(reset);
  afterEach(reset);

  test('keeps a legacy targetLanguage user backward-compatible without inventing progress', async () => {
    db.prepare(
      "INSERT INTO settings (userId, key, value) VALUES ('local', 'targetLanguage', '\"de\"')",
    ).run();

    const response = await onboarding.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ progress: null, profile: null, events: [] });
  });

  test('starts once, recommends a real lesson, and resumes without resetting progress', async () => {
    seedLesson();
    const input = {
      ...profile,
      starterCollectionId: 'onboard-collection',
      recommendedLessonId: 'onboard-lesson-1',
      recommendedLessonTitle: 'client text is not trusted',
    };
    const started = await post(onboarding, '/start', input);
    expect(started.status).toBe(200);
    const first = (await started.json()) as TestSnapshot;
    expect(first.profile).toMatchObject(profile);
    expect(first.progress).toMatchObject({
      version: 1,
      status: 'in_progress',
      currentStep: 'reader',
      language: 'es',
      starterCollectionId: 'onboard-collection',
      recommendedLessonId: 'onboard-lesson-1',
      recommendedLessonTitle: 'Hola',
    });
    expect(first.events.map((event) => event.eventType)).toEqual([
      'onboarding.started',
      'onboarding.profile_saved',
    ]);
    expect(
      (
        db
          .prepare("SELECT value FROM settings WHERE userId = 'local' AND key = 'targetLanguage'")
          .get() as { value: string }
      ).value,
    ).toBe('"es"');

    const advanced = await onboarding.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentStep: 'practice', nextLessonId: 'onboard-lesson-2' }),
    });
    expect(((await advanced.json()) as TestSnapshot).progress).toMatchObject({
      currentStep: 'practice',
      nextLessonId: 'onboard-lesson-2',
      nextLessonTitle: 'Mañana',
    });

    const reopenedReader = await onboarding.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentStep: 'reader', nextLessonId: 'onboard-lesson-2' }),
    });
    expect(((await reopenedReader.json()) as TestSnapshot).progress).toMatchObject({
      currentStep: 'practice',
      nextLessonId: 'onboard-lesson-2',
      nextLessonTitle: 'Mañana',
    });

    const resumed = await post(onboarding, '/start', input);
    const second = (await resumed.json()) as TestSnapshot;
    expect(second.progress.startedAt).toBe(first.progress.startedAt);
    expect(second.progress.currentStep).toBe('practice');
    expect(second.events).toHaveLength(2);
  });

  test('complete and skip are durable terminal states that cannot be restarted', async () => {
    await post(onboarding, '/start', profile);
    const completed = await post(onboarding, '/complete');
    const completeBody = (await completed.json()) as TestSnapshot;
    expect(completeBody.progress.status).toBe('completed');
    expect(completeBody.progress.currentStep).toBe('summary');
    expect(completeBody.progress.completedAt).toBeTruthy();
    expect(completeBody.events.map((event) => event.eventType)).toContain('onboarding.completed');

    const restart = await post(onboarding, '/start', { ...profile, dailyMinutes: 30 });
    const restarted = (await restart.json()) as TestSnapshot;
    expect(restarted.progress.status).toBe('completed');
    expect(restarted.profile.dailyMinutes).toBe(15);

    reset();
    const skipped = await post(onboarding, '/skip', {
      ...profile,
      approximateLevel: 'not_sure',
      interests: [],
    });
    const skipBody = (await skipped.json()) as TestSnapshot;
    expect(skipBody.progress.status).toBe('skipped');
    expect(skipBody.events.map((event) => event.eventType)).toEqual([
      'onboarding.profile_saved',
      'onboarding.skipped',
    ]);
    expect((await post(onboarding, '/complete')).status).toBe(200);
    expect(((await (await onboarding.request('/')).json()) as TestSnapshot).progress.status).toBe(
      'skipped',
    );
  });

  test('rejects malformed profile and progress updates without partial writes', async () => {
    expect((await post(onboarding, '/start', { ...profile, dailyMinutes: 2 })).status).toBe(400);
    expect((await post(onboarding, '/start', { ...profile, interests: ['not-real'] })).status).toBe(
      400,
    );
    expect((await post(onboarding, '/start', { ...profile, language: 'xx' })).status).toBe(400);
    expect(
      (
        await onboarding.request('/', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentStep: 'tour' }),
        })
      ).status,
    ).toBe(409);
    expect(db.prepare('SELECT 1 FROM learner_profiles').get()).toBeNull();
    expect(db.prepare('SELECT 1 FROM onboarding_progress').get()).toBeNull();
  });
});

describe('learner event ingestion', () => {
  beforeEach(() => {
    reset();
    seedLesson();
    db.prepare(
      `INSERT INTO vocab
         (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
       VALUES ('local', 'onboard-vocab', 'hola', 'word', 'Hola mundo.', 'hello', 'new', ?, 'es', ?)`,
    ).run(TS, TS);
  });
  afterEach(reset);

  test('records a validated event once across idempotent retries', async () => {
    const input = {
      eventType: 'vocab.saved',
      language: 'es',
      lessonId: 'onboard-lesson-1',
      vocabId: 'onboard-vocab',
      properties: { source: 'onboarding', text: 'hola' },
      idempotencyKey: 'save:onboard-vocab',
    };
    const first = await post(learnerEvents, '/', input);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as TestEventResult;
    expect(firstBody.recorded).toBe(true);
    expect(firstBody.event).toMatchObject({
      eventType: 'vocab.saved',
      lessonId: 'onboard-lesson-1',
      vocabId: 'onboard-vocab',
      properties: { source: 'onboarding', text: 'hola' },
    });

    const retry = await post(learnerEvents, '/', input);
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as TestEventResult;
    expect(retryBody.recorded).toBe(false);
    expect(retryBody.event.id).toBe(firstBody.event.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM learner_events').get() as { n: number }).n).toBe(
      1,
    );
  });

  test('rejects unknown types and references owned by another tenant', async () => {
    db.prepare(
      `INSERT INTO vocab
         (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
       VALUES ('intruder', 'onboard-foreign', 'secreto', 'word', 'Un secreto.', 'secret', 'new', ?, 'es', ?)`,
    ).run(TS, TS);

    expect((await post(learnerEvents, '/', { ...profile, eventType: 'made.up' })).status).toBe(400);
    expect(
      (
        await post(learnerEvents, '/', {
          eventType: 'vocab.saved',
          language: 'es',
          vocabId: 'onboard-foreign',
        })
      ).status,
    ).toBe(404);
  });
});
