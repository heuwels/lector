import { NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { randomUUID } from 'crypto';
import sentenceBank from '@/lib/sentence-bank.json';

// POST /api/cloze/seed - Seed database from sentence-bank.json
// Only inserts sentences that don't already exist (by tatoebaSentenceId)
export async function POST() {
  const existing = db.prepare(
    'SELECT tatoebaSentenceId FROM clozeSentences WHERE tatoebaSentenceId IS NOT NULL'
  ).all() as { tatoebaSentenceId: number }[];

  const existingIds = new Set(existing.map(r => r.tatoebaSentenceId));

  const toInsert = (sentenceBank as Array<{
    id: number;
    text: string;
    translation: string;
    clozeWord: string;
    clozeIndex: number;
    wordRank: number | null;
    collection: string;
  }>).filter(s => !existingIds.has(s.id));

  if (toInsert.length === 0) {
    return NextResponse.json({ seeded: 0, total: sentenceBank.length, message: 'Already seeded' });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, masteryLevel, nextReview, reviewCount, timesCorrect, timesIncorrect)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((items: typeof toInsert) => {
    for (const s of items) {
      stmt.run(
        randomUUID(),
        s.text,
        s.clozeWord,
        s.clozeIndex,
        s.translation,
        'tatoeba',
        s.collection,
        s.wordRank,
        s.id,
        0,
        new Date().toISOString(),
        0,
        0,
        0
      );
    }
  });

  transaction(toInsert);

  return NextResponse.json({ seeded: toInsert.length, total: sentenceBank.length });
}

// GET /api/cloze/seed - Check if seeding is needed
export async function GET() {
  const count = db.prepare(
    'SELECT COUNT(*) as count FROM clozeSentences WHERE (blacklisted = 0 OR blacklisted IS NULL)'
  ).get() as { count: number };

  return NextResponse.json({
    dbCount: count.count,
    bankSize: sentenceBank.length,
    needsSeed: count.count < sentenceBank.length * 0.5,
  });
}
