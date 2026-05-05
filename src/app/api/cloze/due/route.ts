import { NextRequest, NextResponse } from 'next/server';
import { db, ClozeSentenceRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';

// GET /api/cloze/due - Get sentences for practice
// mode=new: never-reviewed sentences (reviewCount = 0)
// mode=review: due for review (nextReview <= now, reviewCount > 0)
// (default): all due sentences (original behavior)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));
  const limit = parseInt(searchParams.get('limit') || '20');
  const collection = searchParams.get('collection');
  const mode = searchParams.get('mode'); // 'new' | 'review' | null
  const excludeWords = searchParams.get('excludeWords')?.split(',').filter(Boolean) || [];

  const now = new Date().toISOString();

  let query: string;
  const params: unknown[] = [];

  if (mode === 'new') {
    // Never-reviewed sentences
    query = 'SELECT * FROM clozeSentences WHERE reviewCount = 0 AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(lang);
  } else if (mode === 'review') {
    // Due for review (already seen at least once)
    query = 'SELECT * FROM clozeSentences WHERE nextReview <= ? AND reviewCount > 0 AND masteryLevel < 100 AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(now, lang);
  } else {
    // Default: all due
    query = 'SELECT * FROM clozeSentences WHERE nextReview <= ? AND (blacklisted = 0 OR blacklisted IS NULL) AND language = ?';
    params.push(now, lang);
  }

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
