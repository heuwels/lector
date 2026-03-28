import { NextRequest, NextResponse } from 'next/server';
import { db, ClozeSentenceRow } from '@/lib/server/database';

// GET /api/cloze/due - Get sentences due for review
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '20');
  const collection = searchParams.get('collection');
  const excludeWords = searchParams.get('excludeWords')?.split(',').filter(Boolean) || [];

  const now = new Date().toISOString();

  let query = 'SELECT * FROM clozeSentences WHERE nextReview <= ? AND (blacklisted = 0 OR blacklisted IS NULL)';
  const params: unknown[] = [now];

  if (collection) {
    query += ' AND collection = ?';
    params.push(collection);
  }

  if (excludeWords.length > 0) {
    const placeholders = excludeWords.map(() => '?').join(',');
    query += ` AND LOWER(clozeWord) NOT IN (${placeholders})`;
    params.push(...excludeWords.map(w => w.toLowerCase()));
  }

  query += ' ORDER BY RANDOM() LIMIT ?';
  params.push(limit);

  const sentences = db.prepare(query).all(...params) as ClozeSentenceRow[];

  return NextResponse.json(sentences.map(s => ({
    ...s,
    nextReview: new Date(s.nextReview),
    lastReviewed: s.lastReviewed ? new Date(s.lastReviewed) : null,
  })));
}
