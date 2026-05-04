import { NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { randomUUID } from 'crypto';
import sentenceBank from '@/lib/sentence-bank.json';

type BankEntry = {
  id: number;
  text: string;
  translation: string;
  clozeWord: string;
  clozeIndex: number;
  wordRank: number | null;
  collection: string;
};

// POST /api/cloze/seed - Seed database from sentence-bank.json
// Inserts new sentences and updates clozeWord/collection for existing ones
export async function POST() {
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
      // Only update unreviewed sentences (don't mess with user progress)
      toUpdate.push({ id: ex.id, clozeWord: s.clozeWord, clozeIndex: s.clozeIndex, wordRank: s.wordRank, collection: s.collection });
    }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, wordRank, tatoebaSentenceId, masteryLevel, nextReview, reviewCount, timesCorrect, timesIncorrect, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE clozeSentences SET clozeWord = ?, clozeIndex = ?, wordRank = ?, collection = ? WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    for (const s of toInsert) {
      insertStmt.run(
        randomUUID(), s.text, s.clozeWord, s.clozeIndex, s.translation,
        'tatoeba', s.collection, s.wordRank, s.id,
        0, new Date().toISOString(), 0, 0, 0, 'af'
      );
    }
    for (const s of toUpdate) {
      updateStmt.run(s.clozeWord, s.clozeIndex, s.wordRank, s.collection, s.id);
    }
  });

  transaction();

  return NextResponse.json({ seeded: toInsert.length, updated: toUpdate.length, total: bank.length });
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
