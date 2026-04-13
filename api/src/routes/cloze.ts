import { Hono } from 'hono';
import { db, ClozeSentenceRow, ClozeMasteryLevel } from '../db';
import { randomUUID } from 'crypto';
import sentenceBank from '../../../src/lib/sentence-bank.json';

type BankEntry = {
  id: number;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  wordRank: number | null;
  collection: string;
};

const app = new Hono();

// GET /api/cloze
app.get('/', (c) => {
  const collection = c.req.query('collection');
  const word = c.req.query('word');
  const limit = parseInt(c.req.query('limit') || '100');

  let query = 'SELECT * FROM clozeSentences WHERE (blacklisted = 0 OR blacklisted IS NULL)';
  const params: unknown[] = [];

  if (collection) { query += ' AND collection = ?'; params.push(collection); }
  if (word) { query += ' AND clozeWord = ?'; params.push(word); }

  query += ' ORDER BY nextReview ASC LIMIT ?';
  params.push(limit);

  const sentences = db.prepare(query).all(...params) as ClozeSentenceRow[];

  return c.json(sentences.map(s => ({
    ...s,
    nextReview: new Date(s.nextReview),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed) : null,
  })));
});

// POST /api/cloze
app.post('/', async (c) => {
  const body = await c.req.json();

  if (Array.isArray(body)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const item of body) {
        stmt.run(
          item.id || randomUUID(), item.sentence, item.clozeWord, item.clozeIndex,
          item.translation, item.source || 'tatoeba', item.collection || 'random',
          item.wordRank || null, item.tatoebaSentenceId || null, item.vocabEntryId || null,
          item.masteryLevel || 0, item.nextReview || new Date().toISOString(),
          item.reviewCount || 0, item.lastReviewed || null,
          item.timesCorrect || 0, item.timesIncorrect || 0
        );
      }
    })();

    return c.json({ success: true, count: body.length });
  }

  const id = body.id || randomUUID();

  db.prepare(`
    INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.sentence, body.clozeWord, body.clozeIndex, body.translation,
    body.source || 'tatoeba', body.collection || 'random', body.wordRank || null,
    body.tatoebaSentenceId || null, body.vocabEntryId || null, body.masteryLevel || 0,
    body.nextReview || new Date().toISOString(), body.reviewCount || 0,
    body.lastReviewed || null, body.timesCorrect || 0, body.timesIncorrect || 0
  );

  return c.json({ id });
});

// GET /api/cloze/due
app.get('/due', (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const collection = c.req.query('collection');
  const mode = c.req.query('mode');
  const excludeWords = c.req.query('excludeWords')?.split(',').filter(Boolean) || [];

  const now = new Date().toISOString();
  let query: string;
  const params: unknown[] = [];

  if (mode === 'new') {
    query = 'SELECT * FROM clozeSentences WHERE reviewCount = 0 AND (blacklisted = 0 OR blacklisted IS NULL)';
  } else if (mode === 'review') {
    query = 'SELECT * FROM clozeSentences WHERE nextReview <= ? AND reviewCount > 0 AND masteryLevel < 100 AND (blacklisted = 0 OR blacklisted IS NULL)';
    params.push(now);
  } else {
    query = 'SELECT * FROM clozeSentences WHERE nextReview <= ? AND (blacklisted = 0 OR blacklisted IS NULL)';
    params.push(now);
  }

  if (collection) { query += ' AND collection = ?'; params.push(collection); }

  if (excludeWords.length > 0) {
    const placeholders = excludeWords.map(() => '?').join(',');
    query += ` AND LOWER(clozeWord) NOT IN (${placeholders})`;
    params.push(...excludeWords.map(w => w.toLowerCase()));
  }

  query += ' ORDER BY RANDOM() LIMIT ?';
  params.push(limit);

  const sentences = db.prepare(query).all(...params) as ClozeSentenceRow[];

  return c.json(sentences.map(s => ({
    ...s,
    nextReview: new Date(s.nextReview),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed) : null,
  })));
});

// GET /api/cloze/counts
app.get('/counts', (c) => {
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT
      collection,
      COUNT(*) as total,
      SUM(CASE WHEN masteryLevel = 100 THEN 1 ELSE 0 END) as mastered,
      SUM(CASE WHEN nextReview <= ? AND masteryLevel < 100 AND reviewCount > 0 THEN 1 ELSE 0 END) as due
    FROM clozeSentences
    WHERE blacklisted = 0 OR blacklisted IS NULL
    GROUP BY collection
  `).all(now) as { collection: string; total: number; mastered: number; due: number }[];

  const counts: Record<string, { total: number; due: number; mastered: number }> = {
    top500: { total: 0, due: 0, mastered: 0 },
    top1000: { total: 0, due: 0, mastered: 0 },
    top2000: { total: 0, due: 0, mastered: 0 },
    mined: { total: 0, due: 0, mastered: 0 },
    random: { total: 0, due: 0, mastered: 0 },
  };

  for (const row of rows) {
    if (row.collection in counts) {
      counts[row.collection] = { total: row.total, mastered: row.mastered, due: row.due };
    }
  }

  return c.json(counts);
});

// POST /api/cloze/seed
app.post('/seed', (c) => {
  const bank = sentenceBank as BankEntry[];

  const existing = db.prepare(
    'SELECT id, tatoebaSentenceId, clozeWord, collection, reviewCount FROM clozeSentences WHERE tatoebaSentenceId IS NOT NULL'
  ).all() as { id: string; tatoebaSentenceId: number; clozeWord: string; collection: string; reviewCount: number }[];

  const existingMap = new Map(existing.map(r => [r.tatoebaSentenceId, r]));

  const toInsert: BankEntry[] = [];
  const toUpdate: { id: string; clozeWord: string; clozeIndex: number; wordRank: number | null; collection: string }[] = [];

  for (const s of bank) {
    const ex = existingMap.get(s.id);
    if (!ex) {
      toInsert.push(s);
    } else if (ex.reviewCount === 0 && (ex.clozeWord !== s.clozeWord || ex.collection !== s.collection)) {
      toUpdate.push({ id: ex.id, clozeWord: s.clozeWord, clozeIndex: s.clozeIndex, wordRank: s.wordRank, collection: s.collection });
    }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, masteryLevel, nextReview, reviewCount, timesCorrect, timesIncorrect)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE clozeSentences SET clozeWord = ?, clozeIndex = ?, wordRank = ?, collection = ? WHERE id = ?
  `);

  db.transaction(() => {
    for (const s of toInsert) {
      insertStmt.run(
        randomUUID(), s.text, s.clozeWord, s.clozeIndex, s.translation,
        'tatoeba', s.collection, s.wordRank, s.id,
        0, new Date().toISOString(), 0, 0, 0
      );
    }
    for (const s of toUpdate) {
      updateStmt.run(s.clozeWord, s.clozeIndex, s.wordRank, s.collection, s.id);
    }
  })();

  return c.json({ seeded: toInsert.length, updated: toUpdate.length, total: bank.length });
});

// GET /api/cloze/seed
app.get('/seed', (c) => {
  const count = db.prepare(
    'SELECT COUNT(*) as count FROM clozeSentences WHERE (blacklisted = 0 OR blacklisted IS NULL)'
  ).get() as { count: number };

  return c.json({
    dbCount: count.count,
    bankSize: sentenceBank.length,
    needsSeed: count.count < sentenceBank.length * 0.5,
  });
});

// GET /api/cloze/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const sentence = db.prepare('SELECT * FROM clozeSentences WHERE id = ?').get(id) as ClozeSentenceRow | undefined;

  if (!sentence) return c.json({ error: 'Not found' }, 404);

  return c.json({
    ...sentence,
    nextReview: new Date(sentence.nextReview),
    lastReviewed: sentence.lastReviewed ? new Date(sentence.lastReviewed) : null,
  });
});

// PUT /api/cloze/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = db.prepare('SELECT id FROM clozeSentences WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  const fields = ['sentence', 'clozeWord', 'clozeIndex', 'translation', 'source', 'collection', 'wordRank', 'masteryLevel', 'nextReview', 'reviewCount', 'lastReviewed', 'timesCorrect', 'timesIncorrect', 'blacklisted'];

  for (const field of fields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[field] instanceof Date ? body[field].toISOString() : body[field]);
    }
  }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE clozeSentences SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  return c.json({ success: true });
});

// DELETE /api/cloze/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM clozeSentences WHERE id = ?').run(id);
  return c.json({ success: true });
});

// POST /api/cloze/:id/review
app.post('/:id/review', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const sentence = db.prepare('SELECT * FROM clozeSentences WHERE id = ?').get(id) as ClozeSentenceRow | undefined;
  if (!sentence) return c.json({ error: 'Not found' }, 404);

  const correct = body.correct as boolean;
  const newMasteryLevel = body.masteryLevel as ClozeMasteryLevel;
  const nextReview = body.nextReview as string;

  db.prepare(`
    UPDATE clozeSentences SET
      masteryLevel = ?,
      nextReview = ?,
      reviewCount = reviewCount + 1,
      lastReviewed = ?,
      timesCorrect = timesCorrect + ?,
      timesIncorrect = timesIncorrect + ?
    WHERE id = ?
  `).run(newMasteryLevel, nextReview, new Date().toISOString(), correct ? 1 : 0, correct ? 0 : 1, id);

  return c.json({ success: true });
});

export default app;
