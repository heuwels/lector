import { Hono } from 'hono';
import { createHash } from 'crypto';
import { db } from '../db';
import { getCurrentUserId } from '../lib/user';
import { LANGUAGES, isValidLanguageCode } from '../lib/languages';
import { countWords } from '../lib/html-to-markdown';
import { hasStarterContent, loadStarterContent } from '../lib/starter-content';
import {
  entitlements,
  planLimitResponse,
  type AtomicLimitCheck,
  type LimitVerdict,
} from '../lib/entitlements';
import { collectionMetadataBytes, lessonTextBytes } from '../lib/storage-limits';

// Starter content seeding (#315). Both language-selection paths (setup page,
// language switcher) POST /seed after setting targetLanguage; the empty-library
// CTA reads /status and POSTs the same endpoint. Seeding happens ONCE per
// user+language, guarded by a settings flag rather than row existence — a user
// who deletes the starter collection must not have it resurrected on the next
// language re-select.

const app = new Hono();

const seededKey = (language: string) => `starterSeeded:${language}`;

function starterLessonId(language: string, sourceFile: string): string {
  const digest = createHash('sha256').update(sourceFile).digest('hex');
  return `starter-${language}-lesson-${digest}`;
}

function isSeeded(userId: string, language: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM settings WHERE userId = ? AND key = ?')
    .get(userId, seededKey(language));
}

function firstStarterLesson(userId: string, language: string) {
  return db
    .prepare(
      `SELECT id, title FROM lessons
       WHERE userId = ? AND collectionId = ? AND language = ?
       ORDER BY sortOrder, createdAt LIMIT 1`,
    )
    .get(userId, `starter-${language}`, language) as { id: string; title: string } | undefined;
}

function recommendation(userId: string, language: string) {
  const lesson = firstStarterLesson(userId, language);
  return lesson
    ? {
        collectionId: `starter-${language}`,
        recommendedLessonId: lesson.id,
        recommendedLessonTitle: lesson.title,
      }
    : {};
}

// GET /api/starter/status?language=es — drives the empty-library CTA.
app.get('/status', (c) => {
  const userId = getCurrentUserId(c);
  const language = c.req.query('language');
  if (!language || !isValidLanguageCode(language)) {
    return c.json({ error: 'Invalid language' }, 400);
  }
  const seeded = isSeeded(userId, language);
  return c.json({
    available: hasStarterContent(language),
    seeded,
    ...(seeded ? recommendation(userId, language) : {}),
  });
});

// POST /api/starter/seed { language }
app.post('/seed', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  const language = body.language;
  if (typeof language !== 'string' || !isValidLanguageCode(language)) {
    return c.json({ error: 'Invalid language' }, 400);
  }

  if (isSeeded(userId, language)) {
    return c.json({
      seeded: false,
      reason: 'already-seeded',
      ...recommendation(userId, language),
    });
  }

  // Malformed manifests throw here → app-level onError (500 + Sentry). A pack
  // that ships no starter content is the normal case, not an error.
  const content = loadStarterContent(language);
  if (!content) {
    return c.json({ seeded: false, reason: 'no-content' });
  }

  // Deterministic per-user id — safe under the composite (userId, id) PK
  // (#279) and easy for tests to target.
  const collectionId = `starter-${language}`;
  const now = new Date().toISOString();
  const pack = LANGUAGES[language];

  const insertCollection = db.prepare(`
    INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getCollection = db.prepare('SELECT language FROM collections WHERE userId = ? AND id = ?');
  const hasLesson = db.prepare('SELECT 1 FROM lessons WHERE userId = ? AND id = ?');
  const hasOtherCollectionInLanguage = db.prepare(
    'SELECT 1 FROM collections WHERE userId = ? AND language = ? AND id <> ? LIMIT 1',
  );
  const setFlag = db.prepare(
    'INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)',
  );

  type SeedOutcome =
    | { kind: 'already-seeded' }
    | { kind: 'library-not-empty' }
    | { kind: 'limited'; verdict: Exclude<LimitVerdict, { allowed: true }> }
    | { kind: 'seeded'; insertedCollection: boolean; insertedLessons: number };

  // Determine net-new rows and reserve them under one outer transaction. The
  // entitlement engine nests its own savepoint around the count checks and
  // inserts. Stable ids make retries safe if a prior seed wrote rows but lost
  // its flag, while plain INSERTs ensure existing/lapsed rows are never
  // replaced or deleted merely to fit a lower plan.
  const outcome = db.transaction((): SeedOutcome => {
    if (isSeeded(userId, language)) return { kind: 'already-seeded' };

    // A genuinely non-starter library isn't a fresh start. A known starter
    // collection, however, may be a retry after flag loss and is repaired by
    // inserting only its missing stable lesson ids.
    const existingCollection = getCollection.get(userId, collectionId) as
      | { language: string }
      | undefined;
    // A crafted import can occupy the reserved id. Never attach starter
    // lessons to a collection from a different language or replace that row.
    if (existingCollection && existingCollection.language !== language) {
      setFlag.run(userId, seededKey(language), JSON.stringify(true));
      return { kind: 'library-not-empty' };
    }
    if (hasOtherCollectionInLanguage.get(userId, language, collectionId)) {
      setFlag.run(userId, seededKey(language), JSON.stringify(true));
      return { kind: 'library-not-empty' };
    }

    const insertedCollection = !existingCollection;
    const lessons = content.lessons.map((lesson, sortOrder) => ({
      ...lesson,
      id: starterLessonId(language, lesson.sourceFile),
      sortOrder,
    }));
    const missingLessons = lessons.filter((lesson) => !hasLesson.get(userId, lesson.id));

    const checks: AtomicLimitCheck[] = [];
    if (insertedCollection) checks.push({ metric: 'maxCollections', requested: 1 });
    if (missingLessons.length > 0) {
      checks.push({ metric: 'maxLessons', requested: missingLessons.length });
      const bytes = missingLessons.map((lesson) => lessonTextBytes(lesson.markdown, lesson.title));
      checks.push(
        { metric: 'maxLessonTextBytes', requested: Math.max(0, ...bytes) },
        {
          metric: 'maxLessonTextBytesTotal',
          requested: bytes.reduce((total, size) => total + size, 0),
        },
      );
    }
    if (insertedCollection) {
      checks.push({
        metric: 'maxCollectionMetadataBytes',
        requested: collectionMetadataBytes(content),
      });
    }

    const verdict = entitlements.reserveCount(userId, checks, () => {
      if (insertedCollection) {
        insertCollection.run(
          collectionId,
          content.title,
          content.author,
          null,
          language,
          now,
          now,
          userId,
        );
      }
      for (const lesson of missingLessons) {
        insertLesson.run(
          lesson.id,
          collectionId,
          lesson.title,
          lesson.sortOrder,
          lesson.markdown,
          countWords(lesson.markdown, pack),
          language,
          now,
          now,
          userId,
        );
      }
      setFlag.run(userId, seededKey(language), JSON.stringify(true));
    });
    return verdict.allowed
      ? { kind: 'seeded', insertedCollection, insertedLessons: missingLessons.length }
      : { kind: 'limited', verdict };
  })();

  if (outcome.kind === 'already-seeded') {
    return c.json({ seeded: false, reason: 'already-seeded', ...recommendation(userId, language) });
  }
  if (outcome.kind === 'library-not-empty') {
    return c.json({ seeded: false, reason: 'library-not-empty' });
  }
  if (outcome.kind === 'limited') return planLimitResponse(c, outcome.verdict);
  if (!outcome.insertedCollection && outcome.insertedLessons === 0) {
    return c.json({ seeded: false, reason: 'already-present' });
  }
  return c.json({
    seeded: true,
    collectionId,
    lessonCount: content.lessons.length,
    ...recommendation(userId, language),
  });
});

export default app;
