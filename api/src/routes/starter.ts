import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { getCurrentUserId } from '../lib/user';
import { LANGUAGES, isValidLanguageCode } from '../lib/languages';
import { countWords } from '../lib/html-to-markdown';
import { hasStarterContent, loadStarterContent } from '../lib/starter-content';

// Starter content seeding (#315). Both language-selection paths (setup page,
// language switcher) POST /seed after setting targetLanguage; the empty-library
// CTA reads /status and POSTs the same endpoint. Seeding happens ONCE per
// user+language, guarded by a settings flag rather than row existence — a user
// who deletes the starter collection must not have it resurrected on the next
// language re-select.

const app = new Hono();

const seededKey = (language: string) => `starterSeeded:${language}`;

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

  const setFlag = db.prepare(
    'INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)',
  );

  // A library that already has collections in this language isn't a fresh
  // start — don't inject content into it (e.g. rows imported via API token
  // before the language was ever UI-selected). Set the flag so the skip is
  // permanent rather than re-evaluated every switch.
  const existing = db
    .prepare('SELECT COUNT(*) AS n FROM collections WHERE userId = ? AND language = ?')
    .get(userId, language) as { n: number };
  if (existing.n > 0) {
    setFlag.run(userId, seededKey(language), JSON.stringify(true));
    return c.json({ seeded: false, reason: 'library-not-empty' });
  }

  // Deterministic per-user id — safe under the composite (userId, id) PK
  // (#279) and easy for tests to target.
  const collectionId = `starter-${language}`;
  const now = new Date().toISOString();
  const pack = LANGUAGES[language];
  const lessons = content.lessons.map((lesson) => ({ ...lesson, id: randomUUID() }));

  const insertCollection = db.prepare(`
    INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLesson = db.prepare(`
    INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
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
    lessons.forEach((lesson, i) => {
      insertLesson.run(
        lesson.id,
        collectionId,
        lesson.title,
        i,
        lesson.markdown,
        countWords(lesson.markdown, pack),
        language,
        now,
        now,
        userId,
      );
    });
    setFlag.run(userId, seededKey(language), JSON.stringify(true));
  })();

  return c.json({
    seeded: true,
    collectionId,
    lessonCount: lessons.length,
    recommendedLessonId: lessons[0]?.id,
    recommendedLessonTitle: lessons[0]?.title,
  });
});

export default app;
