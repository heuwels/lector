import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, VocabRow } from '../db';
import { getCurrentUserId } from '../lib/user';
import { resolveLanguage } from '../lib/active-language';

const app = new Hono();

// POST /api/practice/srs-queue
// Returns a prioritized queue of up to 50 words for SRS review.
// Body: { levels: number[], bookId?: string }
// Filters: srs_level IN (levels) AND next_review <= NOW()
// Optional book filter: word_id IN (SELECT word_id FROM book_words WHERE book_id = ?)
// Sorting: ORDER BY next_review ASC, srs_level ASC
// Limit: 50
app.post('/srs-queue', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();

  if (!body || !Array.isArray(body.levels) || body.levels.length === 0) {
    return c.json({ error: 'levels must be a non-empty array of integers 1-7' }, 400);
  }

  // Validate levels are 1-7
  const levels = body.levels;
  for (const level of levels) {
    if (!Number.isInteger(level) || level < 1 || level > 7) {
      return c.json({ error: 'All levels must be integers between 1 and 7' }, 400);
    }
  }

  const bookId = body.bookId;
  if (bookId !== undefined) {
    if (typeof bookId !== 'string' || bookId.trim() === '') {
      return c.json({ error: 'bookId must be a non-empty string if provided' }, 400);
    }
  }

  const safeLimit = 50;
  const lang = resolveLanguage(body.language, userId);

  // Build the query
  const placeholders = levels.map(() => '?').join(',');
  const params: SQLQueryBindings[] = [userId, lang, new Date().toISOString(), ...levels];

  let query = `
    SELECT * FROM vocab
    WHERE userId = ?
    AND language = ?
    AND next_review IS NOT NULL
    AND next_review <= ?
    AND srs_level IN (${placeholders})
  `;

  // Book filter: filter by vocab.bookId column
  if (bookId) {
    query += ' AND bookId = ?';
    params.push(bookId);
  }

  query += ' ORDER BY next_review ASC, srs_level ASC LIMIT ?';
  params.push(safeLimit);

  const rows = db.prepare(query).all(...params) as VocabRow[];

  const results = rows.map((v) => ({
    id: v.id,
    text: v.text,
    type: v.type,
    sentence: v.sentence,
    translation: v.translation,
    state: v.state,
    stateUpdatedAt: v.stateUpdatedAt,
    reviewCount: v.reviewCount,
    bookId: v.bookId,
    chapter: v.chapter,
    createdAt: v.createdAt,
    pushedToAnki: v.pushedToAnki === 1,
    ankiNoteId: v.ankiNoteId,
    srs_level: v.srs_level,
    next_review: v.next_review,
    last_review: v.last_review,
  }));

  return c.json({ words: results });
});

export default app;
