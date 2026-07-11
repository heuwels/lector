import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, VocabRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { foldWord, getLanguageConfig, normalizeText } from '../lib/languages';
import { getCurrentUserId } from '../lib/user';
import { randomUUID } from 'crypto';
import { entitlements, planLimitResponse, type AtomicLimitCheck } from '../lib/entitlements';
import {
  aggregateGrowthCheck,
  batchGrowthCheck,
  growingRowCheck,
  utf8Bytes,
  vocabContentBytes,
  validatePersistedId,
} from '../lib/storage-limits';
import {
  booleanLikeToSql,
  validateBooleanLike,
  validateEnum,
  validateOptionalLanguage,
  validateOwnedReference,
  validateSafeInteger,
  validateWordKey,
} from '../lib/persisted-input';

const app = new Hono();
const VOCAB_TYPES = new Set(['word', 'phrase'] as const);
const WORD_STATES = new Set([
  'new',
  'level1',
  'level2',
  'level3',
  'level4',
  'known',
  'ignored',
] as const);

// GET /api/vocab
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const state = c.req.query('state');
  const bookId = c.req.query('bookId');
  const unpushed = c.req.query('unpushed');
  const text = c.req.query('text');

  let query = 'SELECT * FROM vocab WHERE userId = ? AND language = ?';
  const params: SQLQueryBindings[] = [userId, lang];

  if (state) {
    query += ' AND state = ?';
    params.push(state);
  }
  if (bookId) {
    query += ' AND bookId = ?';
    params.push(bookId);
  }
  if (unpushed === 'true') {
    query += ' AND pushedToAnki = 0';
  }
  // Exact match, deliberately not LOWER(): callers pass the already-folded
  // word (foldWord, #289 — same semantics as the old client-side
  // `.find(v.text === text)`), and the exact comparison rides
  // idx_vocab_user_lang_text (#239/#240).
  if (text) {
    query += ' AND text = ?';
    params.push(text);
  }

  query += ' ORDER BY createdAt DESC';

  const vocab = db.prepare(query).all(...params) as VocabRow[];

  return c.json(
    vocab.map((v) => ({
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
    })),
  );
});

// POST /api/vocab
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  if (body.id !== undefined) {
    const idError = validatePersistedId(body.id);
    if (idError) return c.json({ error: idError }, 400);
  }
  const bookIdError = validateOwnedReference('collections', body.bookId, userId, 'bookId');
  if (bookIdError) return c.json({ error: bookIdError }, 400);
  const languageError = validateOptionalLanguage(body.language);
  if (languageError) return c.json({ error: languageError }, 400);
  const textError = validateWordKey(body.text, 'text');
  if (textError) return c.json({ error: textError }, 400);
  if (body.sentence !== undefined && typeof body.sentence !== 'string') {
    return c.json({ error: 'sentence must be a string' }, 400);
  }
  if (body.translation !== undefined && typeof body.translation !== 'string') {
    return c.json({ error: 'translation must be a string' }, 400);
  }
  const typeError = validateEnum(body.type, 'type', VOCAB_TYPES);
  if (typeError) return c.json({ error: typeError }, 400);
  const stateError = validateEnum(body.state, 'state', WORD_STATES);
  if (stateError) return c.json({ error: stateError }, 400);
  for (const [field, nullable] of [
    ['reviewCount', false],
    ['chapter', true],
    ['ankiNoteId', true],
  ] as const) {
    const error = validateSafeInteger(body[field], field, { min: 0, nullable });
    if (error) return c.json({ error }, 400);
  }
  const pushedError = validateBooleanLike(body.pushedToAnki, 'pushedToAnki');
  if (pushedError) return c.json({ error: pushedError }, 400);
  const id = body.id || randomUUID();
  const now = new Date().toISOString();
  const lang = resolveLanguage(body.language, userId);
  const pack = getLanguageConfig(lang);
  // Text ingress (#289): NFC the stored form; the knownWords key is folded.
  const text = normalizeText(body.text);
  const sentence = body.sentence ?? '';
  const translation = body.translation ?? '';
  const foldedText = foldWord(text, pack);
  const existing = db
    .prepare('SELECT text, sentence, translation FROM vocab WHERE id = ? AND userId = ?')
    .get(id, userId) as { text: string; sentence: string; translation: string } | undefined;
  const knownExists = !!db
    .prepare('SELECT 1 FROM knownWords WHERE userId = ? AND word = ? AND language = ?')
    .get(userId, foldedText, lang);
  const previousVocabBytes = existing ? vocabContentBytes(existing) : 0;
  const nextVocabBytes = vocabContentBytes({ text, sentence, translation });
  const vocabGrowth = Math.max(0, nextVocabBytes - previousVocabBytes);
  const knownGrowth = knownExists ? 0 : utf8Bytes(foldedText);
  const checks: AtomicLimitCheck[] = [
    ...(existing ? [] : [{ metric: 'maxVocabEntries' as const }]),
    ...growingRowCheck('maxVocabEntryBytes', nextVocabBytes, previousVocabBytes),
    ...aggregateGrowthCheck('maxVocabTextBytesTotal', nextVocabBytes, previousVocabBytes),
    ...(knownExists ? [] : [{ metric: 'maxKnownWords' as const }]),
    ...growingRowCheck('maxKnownWordBytes', knownGrowth),
    ...aggregateGrowthCheck('maxKnownWordsTextBytesTotal', knownGrowth),
    ...batchGrowthCheck(vocabGrowth + knownGrowth),
  ];

  // Upsert on the composite (userId, id) PK (#279): ids are per-tenant, so a
  // client-supplied id belonging to another tenant is simply a different row —
  // re-posting your own id updates it, someone else's id creates yours.
  const verdict = entitlements.reserveCount(userId, checks, () => {
    db.prepare(
      `
      INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId, language, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, id) DO UPDATE SET
        text = excluded.text, type = excluded.type, sentence = excluded.sentence,
        translation = excluded.translation, state = excluded.state,
        stateUpdatedAt = excluded.stateUpdatedAt, reviewCount = excluded.reviewCount,
        bookId = excluded.bookId, chapter = excluded.chapter, createdAt = excluded.createdAt,
        pushedToAnki = excluded.pushedToAnki, ankiNoteId = excluded.ankiNoteId,
        language = excluded.language
    `,
    ).run(
      id,
      text,
      body.type ?? 'word',
      sentence,
      translation,
      body.state ?? 'new',
      now,
      body.reviewCount ?? 0,
      body.bookId ?? null,
      body.chapter ?? null,
      now,
      body.pushedToAnki === undefined ? 0 : booleanLikeToSql(body.pushedToAnki as boolean | 0 | 1),
      body.ankiNoteId ?? null,
      lang,
      userId,
    );

    db.prepare(
      `INSERT INTO knownWords (userId, word, language, state) VALUES (?, ?, ?, ?)
       ON CONFLICT(userId, word, language) DO UPDATE SET state = excluded.state`,
    ).run(userId, foldedText, lang, body.state ?? 'new');
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ id });
});

// GET /api/vocab/:id
app.get('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const vocab = db.prepare('SELECT * FROM vocab WHERE id = ? AND userId = ?').get(id, userId) as
    | VocabRow
    | undefined;

  if (!vocab) return c.json({ error: 'Vocab not found' }, 404);

  return c.json({ ...vocab, pushedToAnki: vocab.pushedToAnki === 1 });
});

// PUT /api/vocab/:id
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  const stateError = validateEnum(body.state, 'state', WORD_STATES);
  if (stateError) return c.json({ error: stateError }, 400);
  if (body.translation !== undefined && typeof body.translation !== 'string') {
    return c.json({ error: 'translation must be a string' }, 400);
  }
  if (body.sentence !== undefined && typeof body.sentence !== 'string') {
    return c.json({ error: 'sentence must be a string' }, 400);
  }
  const reviewCountError = validateSafeInteger(body.reviewCount, 'reviewCount', { min: 0 });
  if (reviewCountError) return c.json({ error: reviewCountError }, 400);
  const pushedError = validateBooleanLike(body.pushedToAnki, 'pushedToAnki');
  if (pushedError) return c.json({ error: pushedError }, 400);
  const ankiNoteIdError = validateSafeInteger(body.ankiNoteId, 'ankiNoteId', {
    min: 0,
    nullable: true,
  });
  if (ankiNoteIdError) return c.json({ error: ankiNoteIdError }, 400);

  const existing = db.prepare('SELECT * FROM vocab WHERE id = ? AND userId = ?').get(id, userId) as
    | VocabRow
    | undefined;
  if (!existing) return c.json({ error: 'Vocab not found' }, 404);

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];
  let knownWrite: { word: string; language: string; state: string } | null = null;

  if (body.state !== undefined) {
    updates.push('state = ?', 'stateUpdatedAt = ?');
    values.push(body.state, new Date().toISOString());
    const vocabLang = existing.language;
    const vocabPack = getLanguageConfig(resolveLanguage(vocabLang, userId));
    knownWrite = {
      word: foldWord(existing.text, vocabPack),
      language: vocabLang,
      state: body.state,
    };
  }
  if (body.translation !== undefined) {
    updates.push('translation = ?');
    values.push(body.translation);
  }
  if (body.sentence !== undefined) {
    updates.push('sentence = ?');
    values.push(body.sentence);
  }
  if (body.reviewCount !== undefined) {
    updates.push('reviewCount = ?');
    values.push(body.reviewCount);
  }
  if (body.pushedToAnki !== undefined) {
    updates.push('pushedToAnki = ?');
    values.push(booleanLikeToSql(body.pushedToAnki as boolean | 0 | 1));
  }
  if (body.ankiNoteId !== undefined) {
    updates.push('ankiNoteId = ?');
    values.push(body.ankiNoteId);
  }

  const previousVocabBytes = vocabContentBytes(existing);
  const nextVocabBytes = vocabContentBytes({
    text: existing.text,
    sentence: body.sentence !== undefined ? body.sentence : existing.sentence,
    translation: body.translation !== undefined ? body.translation : existing.translation,
  });
  const knownExists =
    knownWrite === null ||
    !!db
      .prepare('SELECT 1 FROM knownWords WHERE userId = ? AND word = ? AND language = ?')
      .get(userId, knownWrite.word, knownWrite.language);
  const knownGrowth = !knownExists && knownWrite ? utf8Bytes(knownWrite.word) : 0;
  const checks: AtomicLimitCheck[] = [
    ...growingRowCheck('maxVocabEntryBytes', nextVocabBytes, previousVocabBytes),
    ...aggregateGrowthCheck('maxVocabTextBytesTotal', nextVocabBytes, previousVocabBytes),
    ...(knownExists ? [] : [{ metric: 'maxKnownWords' as const }]),
    ...growingRowCheck('maxKnownWordBytes', knownGrowth),
    ...aggregateGrowthCheck('maxKnownWordsTextBytesTotal', knownGrowth),
    ...batchGrowthCheck(
      Math.max(0, nextVocabBytes - previousVocabBytes) + Math.max(0, knownGrowth),
    ),
  ];

  if (updates.length > 0) {
    values.push(id, userId);
    const verdict = entitlements.reserveCount(userId, checks, () => {
      if (knownWrite) {
        db.prepare(
          `INSERT INTO knownWords (userId, word, language, state) VALUES (?, ?, ?, ?)
           ON CONFLICT(userId, word, language) DO UPDATE SET state = excluded.state`,
        ).run(userId, knownWrite.word, knownWrite.language, knownWrite.state);
      }
      db.prepare(`UPDATE vocab SET ${updates.join(', ')} WHERE id = ? AND userId = ?`).run(
        ...values,
      );
    });
    if (!verdict.allowed) return planLimitResponse(c, verdict);
  }

  return c.json({ success: true });
});

// DELETE /api/vocab/:id
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const vocab = db
    .prepare('SELECT text, language FROM vocab WHERE id = ? AND userId = ?')
    .get(id, userId) as { text: string; language: string } | undefined;

  if (!vocab) return c.json({ error: 'Vocab not found' }, 404);

  const vocabLang = vocab.language;
  db.prepare('DELETE FROM vocab WHERE id = ? AND userId = ?').run(id, userId);

  // Compare folded keys in app code, not SQL (#289): SQLite's LOWER() is
  // ASCII-only, so LOWER('HÄUSER') keeps the Ä and case-variant duplicates
  // were miscounted for any non-ASCII word — Cyrillic/Greek entirely so.
  const vocabPack = getLanguageConfig(resolveLanguage(vocabLang, userId));
  const foldedText = foldWord(vocab.text, vocabPack);
  const remaining = db
    .prepare('SELECT text FROM vocab WHERE userId = ? AND language = ?')
    .all(userId, vocabLang) as { text: string }[];
  const others = remaining.filter((r) => foldWord(r.text, vocabPack) === foldedText).length;
  if (others === 0) {
    db.prepare('DELETE FROM knownWords WHERE userId = ? AND word = ? AND language = ?').run(
      userId,
      foldedText,
      vocabLang,
    );
  }

  return c.json({ success: true });
});

export default app;
