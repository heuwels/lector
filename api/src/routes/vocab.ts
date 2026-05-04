import { Hono } from 'hono';
import { db, VocabRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { randomUUID } from 'crypto';

const app = new Hono();

// GET /api/vocab
app.get('/', (c) => {
  const lang = resolveLanguage(c.req.query('language'));
  const state = c.req.query('state');
  const bookId = c.req.query('bookId');
  const unpushed = c.req.query('unpushed');

  let query = 'SELECT * FROM vocab WHERE language = ?';
  const params: unknown[] = [lang];

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
  const lang = resolveLanguage(body.language);

  db.prepare(`
    INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.text, body.type || 'word', body.sentence || '', body.translation || '',
    body.state || 'new', now, body.reviewCount || 0, body.bookId || null,
    body.chapter || null, now, body.pushedToAnki ? 1 : 0, body.ankiNoteId || null, lang
  );

  db.prepare('INSERT OR REPLACE INTO knownWords (word, language, state) VALUES (?, ?, ?)').run(body.text.toLowerCase(), lang, body.state || 'new');

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
    const vocabLang = (existing as VocabRow & { language?: string }).language || 'af';
    db.prepare('INSERT OR REPLACE INTO knownWords (word, language, state) VALUES (?, ?, ?)').run(existing.text.toLowerCase(), vocabLang, body.state);
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
  const vocab = db.prepare('SELECT text, language FROM vocab WHERE id = ?').get(id) as { text: string; language: string } | undefined;

  if (!vocab) return c.json({ error: 'Vocab not found' }, 404);

  const vocabLang = vocab.language || 'af';
  db.prepare('DELETE FROM vocab WHERE id = ?').run(id);

  const others = db.prepare('SELECT COUNT(*) as count FROM vocab WHERE LOWER(text) = ? AND language = ?').get(vocab.text.toLowerCase(), vocabLang) as { count: number };
  if (others.count === 0) {
    db.prepare('DELETE FROM knownWords WHERE word = ? AND language = ?').run(vocab.text.toLowerCase(), vocabLang);
  }

  return c.json({ success: true });
});

export default app;
