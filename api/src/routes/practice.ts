import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, VocabRow } from '../db';
import { getCurrentUserId } from '../lib/user';
import { resolveLanguage } from '../lib/active-language';

const app = new Hono();

// POST /api/practice/srs-queue
// Returns a prioritized queue of up to 50 words for SRS review.
// Body: { levels: number[], bookId?: string, language?: string }
// The word's learning level lives in `state` (`level1`..`level7`) — the reader
// assigns it and updateSRS advances it. A word is due when it has never been
// reviewed (`next_review IS NULL`) or its scheduled date has passed.
// Filters: state IN ('levelN' for the requested levels) AND next_review due
// Optional book filter: vocab.bookId = ?
// Sorting: ORDER BY next_review ASC (NULLs first), srs_level ASC
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

  // A level N word is stored as state 'levelN'.
  const levelStates = levels.map((level: number) => `level${level}`);
  const placeholders = levelStates.map(() => '?').join(',');
  const params: SQLQueryBindings[] = [userId, lang, new Date().toISOString(), ...levelStates];

  let query = `
    SELECT * FROM vocab
    WHERE userId = ?
    AND language = ?
    AND (next_review IS NULL OR next_review <= ?)
    AND state IN (${placeholders})
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
