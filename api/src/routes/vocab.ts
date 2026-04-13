import { Hono } from 'hono';
import { db, VocabRow } from '../db';
import { randomUUID } from 'crypto';

const app = new Hono();

// GET /api/vocab
app.get('/', (c) => {
  const state = c.req.query('state');
  const bookId = c.req.query('bookId');
  const unpushed = c.req.query('unpushed');

  let query = 'SELECT * FROM vocab WHERE 1=1';
  const params: unknown[] = [];

  if (state) { query += ' AND state = ?'; params.push(state); }
  if (bookId) { query += ' AND bookId = ?'; params.push(bookId); }
  if (unpushed === 'true') { query += ' AND pushedToAnki = 0'; }

  query += ' ORDER BY createdAt DESC';

  const vocab = db.prepare(query).all(...params) as VocabRow[];

  return c.json(vocab.map(v => ({
    id: v.id, text: v.text, type: v.type, sentence: v.sentence,
    translation: v.translation, state: v.state, stateUpdatedAt: v.stateUpdatedAt,
    reviewCount: v.reviewCount, bookId: v.bookId, chapter: v.chapter,
    createdAt: v.createdAt, pushedToAnki: v.pushedToAnki === 1, ankiNoteId: v.ankiNoteId,
  })));
});

// POST /api/vocab
app.post('/', async (c) => {
  const body = await c.req.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.text, body.type || 'word', body.sentence || '', body.translation || '',
    body.state || 'new', now, body.reviewCount || 0, body.bookId || null,
    body.chapter || null, now, body.pushedToAnki ? 1 : 0, body.ankiNoteId || null
  );

  db.prepare('INSERT OR REPLACE INTO knownWords (word, state) VALUES (?, ?)').run(body.text.toLowerCase(), body.state || 'new');

  return c.json({ id });
});

// GET /api/vocab/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const vocab = db.prepare('SELECT * FROM vocab WHERE id = ?').get(id) as VocabRow | undefined;

  if (!vocab) return c.json({ error: 'Vocab not found' }, 404);

  return c.json({ ...vocab, pushedToAnki: vocab.pushedToAnki === 1 });
});

// PUT /api/vocab/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = db.prepare('SELECT * FROM vocab WHERE id = ?').get(id) as VocabRow | undefined;
  if (!existing) return c.json({ error: 'Vocab not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.state !== undefined) {
    updates.push('state = ?', 'stateUpdatedAt = ?');
    values.push(body.state, new Date().toISOString());
    db.prepare('INSERT OR REPLACE INTO knownWords (word, state) VALUES (?, ?)').run(existing.text.toLowerCase(), body.state);
  }
  if (body.translation !== undefined) { updates.push('translation = ?'); values.push(body.translation); }
  if (body.sentence !== undefined) { updates.push('sentence = ?'); values.push(body.sentence); }
  if (body.reviewCount !== undefined) { updates.push('reviewCount = ?'); values.push(body.reviewCount); }
  if (body.pushedToAnki !== undefined) { updates.push('pushedToAnki = ?'); values.push(body.pushedToAnki ? 1 : 0); }
  if (body.ankiNoteId !== undefined) { updates.push('ankiNoteId = ?'); values.push(body.ankiNoteId); }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE vocab SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return c.json({ success: true });
});

// DELETE /api/vocab/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const vocab = db.prepare('SELECT text FROM vocab WHERE id = ?').get(id) as { text: string } | undefined;

  if (!vocab) return c.json({ error: 'Vocab not found' }, 404);

  db.prepare('DELETE FROM vocab WHERE id = ?').run(id);

  const others = db.prepare('SELECT COUNT(*) as count FROM vocab WHERE LOWER(text) = ?').get(vocab.text.toLowerCase()) as { count: number };
  if (others.count === 0) {
    db.prepare('DELETE FROM knownWords WHERE word = ?').run(vocab.text.toLowerCase());
  }

  return c.json({ success: true });
});

export default app;
