import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';

interface CountRow {
  collection: string;
  total: number;
  mastered: number;
  due: number;
}

// GET /api/cloze/counts - Get per-collection counts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT
      collection,
      COUNT(*) as total,
      SUM(CASE WHEN masteryLevel = 100 THEN 1 ELSE 0 END) as mastered,
      SUM(CASE WHEN nextReview <= ? AND masteryLevel < 100 AND reviewCount > 0 THEN 1 ELSE 0 END) as due
    FROM clozeSentences
    WHERE (blacklisted = 0 OR blacklisted IS NULL) AND language = ?
    GROUP BY collection
  `).all(now, lang) as CountRow[];

  const counts: Record<string, { total: number; due: number; mastered: number }> = {
    top500: { total: 0, due: 0, mastered: 0 },
    top1000: { total: 0, due: 0, mastered: 0 },
    top2000: { total: 0, due: 0, mastered: 0 },
    mined: { total: 0, due: 0, mastered: 0 },
    random: { total: 0, due: 0, mastered: 0 },
  };

  for (const row of rows) {
    if (row.collection in counts) {
      counts[row.collection] = {
        total: row.total,
        mastered: row.mastered,
        due: row.due,
      };
    }
  }

  return NextResponse.json(counts);
}
