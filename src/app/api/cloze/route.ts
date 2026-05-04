import { NextRequest, NextResponse } from 'next/server';
import { db, ClozeSentenceRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { randomUUID } from 'crypto';

// GET /api/cloze - List cloze sentences with filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));
  const collection = searchParams.get('collection');
  const word = searchParams.get('word');
  const limit = parseInt(searchParams.get('limit') || '100');

  let query = 'SELECT * FROM clozeSentences WHERE (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
  const params: unknown[] = [lang];

  if (collection) {
    query += ' AND collection = ?';
    params.push(collection);
  }
  if (word) {
    query += ' AND clozeWord = ?';
    params.push(word);
  }

  query += ' ORDER BY nextReview ASC LIMIT ?';
  params.push(limit);

  const sentences = db.prepare(query).all(...params) as ClozeSentenceRow[];

  return NextResponse.json(sentences.map(s => ({
    ...s,
    nextReview: new Date(s.nextReview),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed) : null,
  })));
}

// POST /api/cloze - Create cloze sentence(s)
export async function POST(request: NextRequest) {
  const body = await request.json();

  const lang = resolveLanguage(Array.isArray(body) ? body[0]?.language : body.language);

  // Handle bulk insert
  if (Array.isArray(body)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((items: typeof body) => {
      for (const c of items) {
        stmt.run(
          c.id || randomUUID(),
          c.sentence,
          c.clozeWord,
          c.clozeIndex,
          c.translation,
          c.source || 'tatoeba',
          c.collection || 'random',
          c.wordRank || null,
          c.tatoebaSentenceId || null,
          c.vocabEntryId || null,
          c.masteryLevel || 0,
          c.nextReview || new Date().toISOString(),
          c.reviewCount || 0,
          c.lastReviewed || null,
          c.timesCorrect || 0,
          c.timesIncorrect || 0,
          lang
        );
      }
    });

    transaction(body);
    return NextResponse.json({ success: true, count: body.length });
  }

  // Single insert
  const id = body.id || randomUUID();

  db.prepare(`
    INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, vocabEntryId, masteryLevel, nextReview, reviewCount, lastReviewed, timesCorrect, timesIncorrect, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.sentence,
    body.clozeWord,
    body.clozeIndex,
    body.translation,
    body.source || 'tatoeba',
    body.collection || 'random',
    body.wordRank || null,
    body.tatoebaSentenceId || null,
    body.vocabEntryId || null,
    body.masteryLevel || 0,
    body.nextReview || new Date().toISOString(),
    body.reviewCount || 0,
    body.lastReviewed || null,
    body.timesCorrect || 0,
    body.timesIncorrect || 0,
    lang
  );

  return NextResponse.json({ id });
}
