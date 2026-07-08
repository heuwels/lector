import { Hono } from 'hono';
import { db, JournalEntryRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { correctJournalText } from '../lib/journal-correct';
import { randomUUID } from 'crypto';

const app = new Hono();

const withParsedCorrections = (e: JournalEntryRow) => ({
  ...e,
  corrections: e.corrections ? JSON.parse(e.corrections) : null,
});

// GET /api/journal - list entries, optionally filtered by date
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const date = c.req.query('date');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (date) {
    const entries = db
      .prepare('SELECT * FROM journal_entries WHERE userId = ? AND entryDate = ? AND language = ? ORDER BY createdAt DESC')
      .all(userId, date, lang) as JournalEntryRow[];
    return c.json(entries.map(withParsedCorrections));
  }

  const entries = db
    .prepare('SELECT * FROM journal_entries WHERE userId = ? AND language = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?')
    .all(userId, lang, limit, offset) as JournalEntryRow[];

  return c.json(entries.map(withParsedCorrections));
});

// POST /api/journal - create a new draft entry
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const { body, entryDate, language } = await c.req.json();
  const lang = resolveLanguage(language, userId);
  const date = entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const wordCount = (body || '').trim().split(/\s+/).filter(Boolean).length;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt, userId)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
  ).run(id, body || '', wordCount, date, lang, now, now, userId);

  return c.json({ id, entryDate: date });
});

// GET /api/journal/:id
// By-id routes scope to the user + active language (defense-in-depth): a stale
// cross-language or cross-user id 404s rather than reading/mutating the entry.
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang) as
    | JournalEntryRow
    | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  return c.json(withParsedCorrections(entry));
});

// PUT /api/journal/:id - update draft body
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const body = await c.req.json();

  const existing = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang) as
    | JournalEntryRow
    | undefined;
  if (!existing) return c.json({ error: 'Entry not found' }, 404);

  if (existing.status === 'submitted' && body.body !== undefined) {
    return c.json({ error: 'Cannot edit a submitted entry' }, 400);
  }

  const now = new Date().toISOString();
  const updates: string[] = ['updatedAt = ?'];
  const values: unknown[] = [now];

  if (body.body !== undefined) {
    updates.push('body = ?', 'wordCount = ?');
    const wordCount = body.body.trim().split(/\s+/).filter(Boolean).length;
    values.push(body.body, wordCount);
  }

  values.push(id);
  values.push(userId);
  values.push(lang);
  db.prepare(`UPDATE journal_entries SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/journal/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db.prepare('SELECT id FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang);

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  db.prepare('DELETE FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').run(id, userId, lang);
  return c.json({ success: true });
});

// POST /api/journal/:id/correct — run the LLM correction on an entry and persist
// it (correctedBody + corrections, status → submitted).
app.post('/:id/correct', async (c) => {
  const id = c.req.param('id');
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang) as
    | JournalEntryRow
    | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  if (!entry.body.trim()) return c.json({ error: 'Entry body is empty' }, 400);

  try {
    const data = (await correctJournalText(userId, entry.body, entry.language)) as {
      correctedBody?: string;
      corrections?: unknown;
    };

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE journal_entries
       SET correctedBody = ?, corrections = ?, status = 'submitted', updatedAt = ?
       WHERE id = ? AND userId = ? AND language = ?`,
    ).run(data.correctedBody ?? null, JSON.stringify(data.corrections ?? null), now, id, userId, lang);

    return c.json({ correctedBody: data.correctedBody, corrections: data.corrections });
  } catch (error) {
    console.error('Journal correction error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Correction failed' }, 500);
  }
});

export default app;
