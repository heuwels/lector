import { NextRequest, NextResponse } from 'next/server';
import { db, VocabRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { randomUUID } from 'crypto';

// GET /api/vocab - List vocab with optional filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));
  const state = searchParams.get('state');
  const bookId = searchParams.get('bookId');
  const unpushed = searchParams.get('unpushed');

  let query = 'SELECT * FROM vocab WHERE language = ?';
  const params: unknown[] = [lang];

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

  query += ' ORDER BY createdAt DESC';

  const vocab = db.prepare(query).all(...params) as VocabRow[];

  return NextResponse.json(vocab.map(v => ({
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
  })));
}

// POST /api/vocab - Create new vocab entry
export async function POST(request: NextRequest) {
  const body = await request.json();

  const id = body.id || randomUUID();
  const now = new Date().toISOString();
  const lang = resolveLanguage(body.language);

  db.prepare(`
    INSERT OR REPLACE INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, reviewCount, bookId, chapter, createdAt, pushedToAnki, ankiNoteId, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.text,
    body.type || 'word',
    body.sentence || '',
    body.translation || '',
    body.state || 'new',
    now,
    body.reviewCount || 0,
    body.bookId || null,
    body.chapter || null,
    now,
    body.pushedToAnki ? 1 : 0,
    body.ankiNoteId || null,
    lang
  );

  // Also update knownWords lookup table
  db.prepare(`
    INSERT OR REPLACE INTO knownWords (word, language, state)
    VALUES (?, ?, ?)
  `).run(body.text.toLowerCase(), lang, body.state || 'new');

  return NextResponse.json({ id });
}
