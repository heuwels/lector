import { Hono } from 'hono';
import { db, ClozeSentenceRow, ClozeMasteryLevel } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { randomUUID } from 'crypto';

type BankEntry = {
  id: number | string;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  wordRank: number | null;
  collection: string;
  source?: 'tatoeba' | 'mined';
};

// Per-language sentence banks, lazily loaded. Each value is a LITERAL dynamic
// import so the bundler still includes the JSON, but the file is only read when
// that language is actually seeded — no need to load every language's bank up
// front. Add a language by dropping in a sentence-bank-<code>.json and
// registering it here. Rows are stored under the language whose bank we load,
// so seeding can never mislabel one language's sentences as another's.
const SENTENCE_BANKS: Record<string, () => Promise<{ default: unknown }>> = {
  af: () => import('../lib/sentence-bank-af.json'),
  de: () => import('../lib/sentence-bank-de.json'),
  es: () => import('../lib/sentence-bank-es.json'),
  fr: () => import('../lib/sentence-bank-fr.json'),
};

async function loadSentenceBank(lang: string): Promise<BankEntry[]> {
  const loader = SENTENCE_BANKS[lang];
  if (!loader) return [];
  return (await loader()).default as BankEntry[];
}

const app = new Hono();

// GET /api/cloze
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'));
  const collection = c.req.query('collection');
  const word = c.req.query('word');
  const limit = parseInt(c.req.query('limit') || '100');

  let query = 'SELECT * FROM clozeSentences WHERE userId = ? AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
  const params: unknown[] = [userId, lang];

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
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  const lang = resolveLanguage(Array.isArray(body) ? body[0]?.language : body.language);

  if (Array.isArray(body)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, language, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const item of body) {
        stmt.run(
          item.id || randomUUID(), item.sentence, item.clozeWord, item.clozeIndex,
          item.translation, item.source || 'tatoeba', item.collection || 'random',
          item.wordRank || null, item.tatoebaSentenceId || null, item.vocabEntryId || null,
          item.masteryLevel || 0, item.nextReview || new Date().toISOString(),
          item.reviewCount || 0, item.lastReviewed || null,
          item.timesCorrect || 0, item.timesIncorrect || 0, lang, userId
        );
      }
    })();

    return c.json({ success: true, count: body.length });
  }

  const id = body.id || randomUUID();

  db.prepare(`
    INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, language, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, body.sentence, body.clozeWord, body.clozeIndex, body.translation,
    body.source || 'tatoeba', body.collection || 'random', body.wordRank || null,
    body.tatoebaSentenceId || null, body.vocabEntryId || null, body.masteryLevel || 0,
    body.nextReview || new Date().toISOString(), body.reviewCount || 0,
    body.lastReviewed || null, body.timesCorrect || 0, body.timesIncorrect || 0, lang, userId
  );

  return c.json({ id });
});

// GET /api/cloze/due
app.get('/due', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'));
  const limit = parseInt(c.req.query('limit') || '20');
  const collection = c.req.query('collection');
  const mode = c.req.query('mode');
  const excludeWords = c.req.query('excludeWords')?.split(',').filter(Boolean) || [];

  const now = new Date().toISOString();
  let query: string;
  const params: unknown[] = [];

  if (mode === 'new') {
    query = 'SELECT * FROM clozeSentences WHERE userId = ? AND reviewCount = 0 AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(userId, lang);
  } else if (mode === 'review') {
    // Due for review (already seen at least once). Mastery-100 cards are
    // included — the scheduler gives them a 14-day maintenance review, which
    // could otherwise never be served (issue #108).
    query = 'SELECT * FROM clozeSentences WHERE userId = ? AND nextReview <= ? AND reviewCount > 0 AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(userId, now, lang);
  } else {
    query = 'SELECT * FROM clozeSentences WHERE userId = ? AND nextReview <= ? AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(userId, now, lang);
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
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'));
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT
      collection,
      COUNT(*) as total,
      SUM(CASE WHEN masteryLevel = 100 THEN 1 ELSE 0 END) as mastered,
      -- Mastery-100 maintenance reviews count as due (issue #108)
      SUM(CASE WHEN nextReview <= ? AND reviewCount > 0 THEN 1 ELSE 0 END) as due
    FROM clozeSentences
    WHERE userId = ? AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?
    GROUP BY collection
  `).all(now, userId, lang) as { collection: string; total: number; mastered: number; due: number }[];

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
app.post('/seed', async (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'));
  const bank = await loadSentenceBank(lang);
  if (bank.length === 0) {
    return c.json({ seeded: 0, updated: 0, mined: 0, tatoeba: 0, total: 0 });
  }

  // Tatoeba rows are deduped by their tatoebaSentenceId; mined rows by their
  // stable string id (stored as the PK) so re-seeding is idempotent for both.
  const existing = db.prepare(
    'SELECT id, tatoebaSentenceId, clozeWord, collection, reviewCount FROM clozeSentences WHERE userId = ? AND tatoebaSentenceId IS NOT NULL AND language = ?'
  ).all(userId, lang) as { id: string; tatoebaSentenceId: number; clozeWord: string; collection: string; reviewCount: number }[];
  const existingMap = new Map(existing.map(r => [r.tatoebaSentenceId, r]));

  const existingMined = new Set(
    (db.prepare("SELECT id FROM clozeSentences WHERE userId = ? AND source = 'mined' AND language = ?")
      .all(userId, lang) as { id: string }[]).map(r => r.id)
  );

  const toInsert: BankEntry[] = [];
  const toUpdate: { id: string; clozeWord: string; clozeIndex: number; wordRank: number | null; collection: string }[] = [];

  for (const s of bank) {
    if ((s.source ?? 'tatoeba') === 'mined') {
      if (!existingMined.has(String(s.id))) toInsert.push(s);
      continue;
    }
    const ex = existingMap.get(s.id as number);
    if (!ex) {
      toInsert.push(s);
    } else if (ex.reviewCount === 0 && (ex.clozeWord !== s.clozeWord || ex.collection !== s.collection)) {
      toUpdate.push({ id: ex.id, clozeWord: s.clozeWord, clozeIndex: s.clozeIndex, wordRank: s.wordRank, collection: s.collection });
    }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, masteryLevel, nextReview, reviewCount, timesCorrect, timesIncorrect, language, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE clozeSentences SET clozeWord = ?, clozeIndex = ?, wordRank = ?, collection = ? WHERE id = ? AND userId = ?
  `);

  db.transaction(() => {
    for (const s of toInsert) {
      const mined = (s.source ?? 'tatoeba') === 'mined';
      insertStmt.run(
        mined ? String(s.id) : randomUUID(), s.text, s.clozeWord, s.clozeIndex, s.translation,
        mined ? 'mined' : 'tatoeba', s.collection, s.wordRank, mined ? null : (s.id as number),
        0, new Date().toISOString(), 0, 0, 0, lang, userId
      );
    }
    for (const s of toUpdate) {
      updateStmt.run(s.clozeWord, s.clozeIndex, s.wordRank, s.collection, s.id, userId);
    }
  })();

  const minedSeeded = toInsert.filter(s => (s.source ?? 'tatoeba') === 'mined').length;
  return c.json({
    seeded: toInsert.length, updated: toUpdate.length,
    mined: minedSeeded, tatoeba: toInsert.length - minedSeeded, total: bank.length,
  });
});

// GET /api/cloze/seed
app.get('/seed', async (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'));
  const bank = await loadSentenceBank(lang);
  const count = db.prepare(
    'SELECT COUNT(*) as count FROM clozeSentences WHERE userId = ? AND language = ? AND (blacklisted = 0 OR blacklisted IS NULL)'
  ).get(userId, lang) as { count: number };

  return c.json({
    dbCount: count.count,
    bankSize: bank.length,
    needsSeed: bank.length > 0 && count.count < bank.length * 0.5,
  });
});

// GET /api/cloze/:id
// By-id routes scope to the user + active language (defense-in-depth): a stale
// cross-language or cross-user id 404s rather than reading/mutating the row.
app.get('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  const sentence = db
    .prepare('SELECT * FROM clozeSentences WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as ClozeSentenceRow | undefined;

  if (!sentence) return c.json({ error: 'Not found' }, 404);

  return c.json({
    ...sentence,
    nextReview: new Date(sentence.nextReview),
    lastReviewed: sentence.lastReviewed ? new Date(sentence.lastReviewed) : null,
  });
});

// PUT /api/cloze/:id
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  const body = await c.req.json();

  const existing = db.prepare('SELECT id FROM clozeSentences WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang);
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
    values.push(userId);
    values.push(lang);
    db.prepare(`UPDATE clozeSentences SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`).run(...values);
  }

  return c.json({ success: true });
});

// DELETE /api/cloze/:id
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  db.prepare('DELETE FROM clozeSentences WHERE id = ? AND userId = ? AND language = ?').run(id, userId, lang);
  return c.json({ success: true });
});

// POST /api/cloze/:id/review
app.post('/:id/review', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  const body = await c.req.json();

  const sentence = db
    .prepare('SELECT * FROM clozeSentences WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as ClozeSentenceRow | undefined;
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
    WHERE id = ? AND userId = ? AND language = ?
  `).run(newMasteryLevel, nextReview, new Date().toISOString(), correct ? 1 : 0, correct ? 0 : 1, id, userId, lang);

  return c.json({ success: true });
});

export default app;
