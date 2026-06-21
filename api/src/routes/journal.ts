import { Hono } from 'hono';
import { db, JournalEntryRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { correctJournalText } from '../lib/journal-correct';
import { randomUUID } from 'crypto';

const app = new Hono();

const withParsedCorrections = (e: JournalEntryRow) => ({
  ...e,
  corrections: e.corrections ? JSON.parse(e.corrections) : null,
});

// GET /api/journal - list entries, optionally filtered by date
app.get('/', (c) => {
  const lang = resolveLanguage(c.req.query('language'));
  const date = c.req.query('date');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  if (date) {
    const entries = db
      .prepare('SELECT * FROM journal_entries WHERE entryDate = ? AND language = ? ORDER BY createdAt DESC')
      .all(date, lang) as JournalEntryRow[];
    return c.json(entries.map(withParsedCorrections));
  }

  const entries = db
    .prepare('SELECT * FROM journal_entries WHERE language = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?')
    .all(lang, limit, offset) as JournalEntryRow[];

  return c.json(entries.map(withParsedCorrections));
});

// POST /api/journal - create a new draft entry
app.post('/', async (c) => {
  const { body, entryDate, language } = await c.req.json();
  const lang = resolveLanguage(language);
  const date = entryDate || new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const wordCount = (body || '').trim().split(/\s+/).filter(Boolean).length;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
  ).run(id, body || '', wordCount, date, lang, now, now);

  return c.json({ id, entryDate: date });
});

// GET /api/journal/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as
    | JournalEntryRow
    | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  return c.json(withParsedCorrections(entry));
});

// PUT /api/journal/:id - update draft body
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as
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
  db.prepare(`UPDATE journal_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/journal/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const entry = db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(id);

  if (!entry) return c.json({ error: 'Entry not found' }, 404);

  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  return c.json({ success: true });
});

// POST /api/journal/:id/correct — run the LLM correction on an entry and persist
// it (correctedBody + corrections, status → submitted).
app.post('/:id/correct', async (c) => {
  const id = c.req.param('id');
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as
    | JournalEntryRow
    | undefined;

  if (!entry) return c.json({ error: 'Entry not found' }, 404);
  if (!entry.body.trim()) return c.json({ error: 'Entry body is empty' }, 400);

  try {
    const data = (await correctJournalText(entry.body, entry.language)) as {
      correctedBody?: string;
      corrections?: unknown;
    };

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE journal_entries
       SET correctedBody = ?, corrections = ?, status = 'submitted', updatedAt = ?
       WHERE id = ?`,
    ).run(data.correctedBody ?? null, JSON.stringify(data.corrections ?? null), now, id);

    return c.json({ correctedBody: data.correctedBody, corrections: data.corrections });
  } catch (error) {
    console.error('Journal correction error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Correction failed' }, 500);
  }
});

export default app;
