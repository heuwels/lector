import '../test-guard';
import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import path from 'path';
import { db } from '../db';
import app from '../routes/starter';
import {
  makeEntitlements,
  parsePlanLimitOverrides,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';

// Point the loader at fixture packs (read per call, so setting it here is
// enough). Only 'es' ships fixture content; 'af' deliberately has none.
const FIXTURE_ROOT = path.resolve(import.meta.dir, '../test-fixtures/starter-content');
const BROKEN_ROOT = path.resolve(import.meta.dir, '../test-fixtures/starter-content-broken');
process.env.STARTER_CONTENT_ROOT = FIXTURE_ROOT;

afterAll(() => {
  delete process.env.STARTER_CONTENT_ROOT;
});

let restoreEngine: (() => void) | null = null;

afterEach(() => {
  restoreEngine?.();
  restoreEngine = null;
});

function useStrictLimits(overrides: Partial<PlanLimits>) {
  restoreEngine?.();
  const defaults = parsePlanLimitOverrides(undefined);
  restoreEngine = setEntitlementsEngineForTests(
    makeEntitlements({
      enforced: true,
      freeTierEnabled: true,
      exemptEmails: new Set(),
      prices: [],
      planLimits: {
        ...defaults,
        free: { ...defaults.free, ...overrides },
      },
      resolveEmail: () => null,
      isByok: () => false,
      compedPlan: () => null,
      now: () => new Date('2026-07-15T12:00:00Z'),
    }),
  );
}

function reset() {
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'starterSeeded:%'").run();
  db.prepare("DELETE FROM billing_subscriptions WHERE userId = 'local'").run();
}

function seed(language: unknown) {
  return app.request('/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
}

function status(language: string) {
  return app.request(`/status?language=${language}`);
}

function collectionCount(language: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM collections WHERE language = ?').get(language) as {
      n: number;
    }
  ).n;
}

describe('starter route', () => {
  beforeEach(reset);

  test('GET /status reports availability and seeded state', async () => {
    const es = await (await status('es')).json();
    expect(es).toEqual({ available: true, seeded: false });

    // af ships no fixture content
    const af = await (await status('af')).json();
    expect(af).toEqual({ available: false, seeded: false });
  });

  test('GET /status rejects an invalid language', async () => {
    expect((await status('xx')).status).toBe(400);
    expect((await app.request('/status')).status).toBe(400);
  });

  test('POST /seed copies the starter collection into the library', async () => {
    const res = await seed('es');
    expect(res.status).toBe(200);
    const seeded = (await res.json()) as {
      seeded: boolean;
      collectionId: string;
      lessonCount: number;
      recommendedLessonId: string;
      recommendedLessonTitle: string;
    };
    expect(seeded).toMatchObject({
      seeded: true,
      collectionId: 'starter-es',
      lessonCount: 2,
      recommendedLessonTitle: 'Hola',
    });
    expect(seeded.recommendedLessonId).toBeTruthy();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get('starter-es') as {
      title: string;
      author: string;
      language: string;
      userId: string;
    };
    expect(collection.title).toBe('Starter Fixture ES');
    expect(collection.author).toBe('Lector');
    expect(collection.language).toBe('es');
    expect(collection.userId).toBe('local');

    const lessons = db
      .prepare('SELECT * FROM lessons WHERE collectionId = ? ORDER BY sortOrder')
      .all('starter-es') as {
      title: string;
      sortOrder: number;
      textContent: string;
      wordCount: number;
      language: string;
      userId: string;
    }[];
    expect(lessons.map((l) => l.title)).toEqual(['Hola', 'La casa']);
    expect(lessons.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect(lessons[0].textContent).toContain('Me llamo Ana');
    expect(lessons[1].textContent).toContain('Mi casa es pequeña');
    for (const lesson of lessons) {
      expect(lesson.wordCount).toBeGreaterThan(0);
      expect(lesson.language).toBe('es');
      expect(lesson.userId).toBe('local');
    }

    expect(await (await status('es')).json()).toEqual({
      available: true,
      seeded: true,
      collectionId: 'starter-es',
      recommendedLessonId: seeded.recommendedLessonId,
      recommendedLessonTitle: 'Hola',
    });
  });

  test('POST /seed is once-only: repeats and deletes do not re-seed', async () => {
    await seed('es');
    expect(collectionCount('es')).toBe(1);

    const repeat = await seed('es');
    expect(await repeat.json()).toMatchObject({
      seeded: false,
      reason: 'already-seeded',
      collectionId: 'starter-es',
      recommendedLessonTitle: 'Hola',
    });
    expect(collectionCount('es')).toBe(1);

    // Deleting the collection must NOT resurrect it on the next select — the
    // settings flag, not row existence, is the guard.
    db.prepare('DELETE FROM lessons WHERE collectionId = ?').run('starter-es');
    db.prepare('DELETE FROM collections WHERE id = ?').run('starter-es');
    const afterDelete = await seed('es');
    expect(await afterDelete.json()).toEqual({ seeded: false, reason: 'already-seeded' });
    expect(collectionCount('es')).toBe(0);
  });

  test('POST /seed atomically refuses a starter batch that exceeds row or byte caps', async () => {
    useStrictLimits({ maxCollections: 0, maxLessons: 100 });
    let res = await seed('es');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxCollections',
      requested: 1,
    });
    expect(collectionCount('es')).toBe(0);
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'starterSeeded:es'").get()).toBeNull();

    useStrictLimits({ maxCollections: 10, maxLessons: 1 });
    res = await seed('es');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxLessons',
      requested: 2,
    });
    expect(collectionCount('es')).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE userId = 'local'").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT 1 FROM settings WHERE key = 'starterSeeded:es'").get()).toBeNull();

    useStrictLimits({
      maxCollections: 10,
      maxLessons: 10,
      maxLessonTextBytes: 1,
    });
    res = await seed('es');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: 'plan_limit',
      metric: 'maxLessonTextBytes',
    });
    expect(collectionCount('es')).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE userId = 'local'").get()).toEqual({
      n: 0,
    });
  });

  test('POST /seed repairs only missing stable lesson ids after flag loss', async () => {
    expect((await seed('es')).status).toBe(200);
    const original = db
      .prepare(
        "SELECT id, title FROM lessons WHERE userId = 'local' AND collectionId = 'starter-es' ORDER BY sortOrder",
      )
      .all() as Array<{ id: string; title: string }>;
    expect(original).toHaveLength(2);

    // Simulate an interrupted/legacy seed: rows survived but the once-only
    // flag and one lesson did not. Learner edits to surviving rows must remain.
    db.prepare("DELETE FROM settings WHERE userId = 'local' AND key = 'starterSeeded:es'").run();
    db.prepare(
      "UPDATE collections SET title = 'My renamed starter' WHERE userId = 'local' AND id = 'starter-es'",
    ).run();
    db.prepare(
      "UPDATE lessons SET title = 'My renamed lesson', progress_percentComplete = 0.5 WHERE userId = 'local' AND id = ?",
    ).run(original[0].id);
    db.prepare("DELETE FROM lessons WHERE userId = 'local' AND id = ?").run(original[1].id);

    useStrictLimits({ maxCollections: 1, maxLessons: 2 });
    const response = await seed('es');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ seeded: true, collectionId: 'starter-es' });

    const repaired = db
      .prepare(
        "SELECT id, title, progress_percentComplete AS progress FROM lessons WHERE userId = 'local' AND collectionId = 'starter-es' ORDER BY sortOrder",
      )
      .all() as Array<{ id: string; title: string; progress: number }>;
    expect(repaired.map((lesson) => lesson.id)).toEqual(original.map((lesson) => lesson.id));
    expect(repaired[0]).toMatchObject({ title: 'My renamed lesson', progress: 0.5 });
    expect(
      db
        .prepare("SELECT title FROM collections WHERE userId = 'local' AND id = 'starter-es'")
        .get(),
    ).toEqual({ title: 'My renamed starter' });
  });

  test('POST /seed does not replace or delete complete starter rows after a downgrade', async () => {
    expect((await seed('es')).status).toBe(200);
    db.prepare("DELETE FROM settings WHERE userId = 'local' AND key = 'starterSeeded:es'").run();
    db.prepare(
      "UPDATE collections SET title = 'Keep me' WHERE userId = 'local' AND id = 'starter-es'",
    ).run();

    // Existing rows are over these deliberately lower caps, but this retry has
    // zero net-new writes and should only restore its flag.
    useStrictLimits({
      maxCollections: 0,
      maxLessons: 0,
      maxLessonTextBytes: 0,
      maxLessonTextBytesTotal: 0,
      maxCollectionMetadataBytes: 0,
    });
    const response = await seed('es');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seeded: false, reason: 'already-present' });
    expect(collectionCount('es')).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE userId = 'local'").get()).toEqual({
      n: 2,
    });
    expect(
      db
        .prepare("SELECT title FROM collections WHERE userId = 'local' AND id = 'starter-es'")
        .get(),
    ).toEqual({ title: 'Keep me' });
  });

  test('POST /seed no-ops cleanly for a pack without starter content', async () => {
    const res = await seed('af');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seeded: false, reason: 'no-content' });
    expect(collectionCount('af')).toBe(0);

    // The flag must NOT be set: if af ships content later, the user's next
    // selection should still receive it.
    const flag = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('starterSeeded:af');
    expect(flag).toBeNull();
  });

  test('POST /seed skips a library that already has collections in the language', async () => {
    db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt)
       VALUES ('mine', 'My Book', 'Me', 'es', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run();

    const res = await seed('es');
    expect(await res.json()).toEqual({ seeded: false, reason: 'library-not-empty' });
    expect(db.prepare('SELECT 1 FROM collections WHERE id = ?').get('starter-es')).toBeNull();

    // The skip is permanent, not re-evaluated per switch.
    const repeat = await seed('es');
    expect(await repeat.json()).toEqual({ seeded: false, reason: 'already-seeded' });
  });

  test('POST /seed rejects invalid languages', async () => {
    expect((await seed('xx')).status).toBe(400);
    expect((await seed(undefined)).status).toBe(400);
    expect((await seed(42)).status).toBe(400);
  });

  test('POST /seed surfaces a malformed manifest as a 500, writing nothing', async () => {
    process.env.STARTER_CONTENT_ROOT = BROKEN_ROOT;
    try {
      const res = await seed('es');
      expect(res.status).toBe(500);
      expect(collectionCount('es')).toBe(0);
      const flag = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('starterSeeded:es');
      expect(flag).toBeNull();
    } finally {
      process.env.STARTER_CONTENT_ROOT = FIXTURE_ROOT;
    }
  });
});
