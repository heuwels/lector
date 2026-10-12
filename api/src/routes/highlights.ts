import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import { db } from '../db';
import { getActiveLanguageCode } from '../lib/active-language';
import { getTodayDate } from '../lib/dates';
import { randomUUID } from 'crypto';

const app = new Hono();

/**
 * GET /api/highlights/phrase?text=&language=
 * Check if a phrase has been previously highlighted by the user.
 */
app.get('/phrase', (c) => {
  const userId = getCurrentUserId(c);
  const text = c.req.query('text');
  const languageCode = c.req.query('language') || getActiveLanguageCode(c);

  if (!text) {
    return c.json({ error: 'text parameter required' }, 400);
  }

  const highlight = db
    .prepare(
      `SELECT * FROM userPhraseHighlights
       WHERE userId = ? AND phraseText = ? AND languageCode = ?
       ORDER BY updatedAt DESC LIMIT 1`,
    )
    .get(userId, text, languageCode);

  return c.json(highlight ?? null);
});

/**
 * POST /api/highlights/phrase
 * Save or update a phrase highlight.
 * Body: { phraseText, wordIds, languageCode, learningStage }
 */
app.post('/phrase', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();

  const { phraseText, wordIds, languageCode, learningStage } = body;

  if (!phraseText || !wordIds || !languageCode || !learningStage) {
    return c.json({ error: 'phraseText, wordIds, languageCode, learningStage required' }, 400);
  }

  if (!Array.isArray(wordIds) || wordIds.length < 2) {
    return c.json({ error: 'wordIds must be an array of 2+ vocab IDs' }, 400);
  }

  const now = getTodayDate();
  const existing = db
    .prepare(
      `SELECT id FROM userPhraseHighlights
       WHERE userId = ? AND phraseText = ? AND languageCode = ?`,
    )
    .get(userId, phraseText, languageCode);

  if (existing) {
    // Update existing highlight
    db.prepare(
      `UPDATE userPhraseHighlights
       SET wordIds = ?, learningStage = ?, updatedAt = ?, reviewCount = reviewCount + 1
       WHERE id = ?`,
    ).run(JSON.stringify(wordIds), learningStage, now, existing.id);
    return c.json({ success: true, id: existing.id, updated: true });
  } else {
    // Create new highlight
    const id = randomUUID();
    db.prepare(
      `INSERT INTO userPhraseHighlights (id, userId, phraseText, wordIds, languageCode, learningStage, createdAt, updatedAt, reviewCount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(id, userId, phraseText, JSON.stringify(wordIds), languageCode, learningStage, now, now);
    return c.json({ success: true, id, updated: false });
  }
});

/**
 * GET /api/highlights/user
 * Get all phrase highlights for the current user.
 * Query params: languageCode, learningStage, limit, offset
 */
app.get('/user', (c) => {
  const userId = getCurrentUserId(c);
  const languageCode = c.req.query('languageCode');
  const learningStage = c.req.query('learningStage');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const offset = Number(c.req.query('offset') ?? 0);

  let sql = `SELECT * FROM userPhraseHighlights WHERE userId = ?`;
  const params: (string | number)[] = [userId];

  if (languageCode) {
    sql += ' AND languageCode = ?';
    params.push(languageCode);
  }
  if (learningStage) {
    sql += ' AND learningStage = ?';
    params.push(learningStage);
  }

  sql += ' ORDER BY updatedAt DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const highlights = db.prepare(sql).all(...params);
  return c.json(highlights);
});

/**
 * DELETE /api/highlights/phrase/:id
 * Delete a phrase highlight by ID.
 */
app.delete('/phrase/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');

  const result = db
    .prepare('DELETE FROM userPhraseHighlights WHERE userId = ? AND id = ?')
    .run(userId, id);

  if (result.changes === 0) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ success: true });
});

/**
 * POST /api/highlights/restore
 * Restore highlights for a lesson - returns highlights for words in the lesson.
 * Body: { lessonId, languageCode }
 */
app.post('/restore', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  const { lessonId, languageCode } = body;

  if (!lessonId || !languageCode) {
    return c.json({ error: 'lessonId and languageCode required' }, 400);
  }

  // Get vocab IDs for this lesson
  const vocabRows = db
    .prepare(`SELECT id FROM vocab WHERE userId = ? AND lessonId = ? AND language = ?`)
    .all(userId, lessonId, languageCode) as { id: string }[];

  const vocabIds = vocabRows.map((r) => r.id);
  if (vocabIds.length === 0) {
    return c.json([]);
  }

  // Find highlights that contain any of these vocab IDs
  // We check each vocab ID against the JSON array in wordIds
  // Efficiently: look for any vocab ID appearing as a substring in wordIds JSON
  const vocabIdPlaceholders = vocabIds.map(() => '?').join(',');
  const highlights = db
    .prepare(
      `SELECT * FROM userPhraseHighlights
       WHERE userId = ? AND languageCode = ?
       AND EXISTS (
         SELECT 1 FROM (
           SELECT wordIds FROM userPhraseHighlights
           WHERE userId = ? AND languageCode = ?
         )
         WHERE EXISTS (
           SELECT value FROM json_each(userPhraseHighlights.wordIds)
           WHERE value IN (${vocabIdPlaceholders})
         )
       )
       ORDER BY updatedAt DESC
       LIMIT 100`,
    )
    .all(userId, languageCode, userId, languageCode, ...vocabIds);

  // Filter to only those where at least one wordId matches
  const filtered = highlights.filter((h) => {
    try {
      const ids = JSON.parse(h.wordIds);
      return ids.some((id: string) => vocabIds.includes(id));
    } catch {
      return false;
    }
  });

  return c.json(filtered);
});

export default app;