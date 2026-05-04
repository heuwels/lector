import { NextRequest, NextResponse } from 'next/server';
import { db, KnownWordRow } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';

// GET /api/known-words - Get all known words as a map
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));

  const words = db.prepare('SELECT * FROM knownWords WHERE language = ?').all(lang) as KnownWordRow[];
  const map: Record<string, string> = {};
  for (const w of words) {
    map[w.word] = w.state;
  }
  return NextResponse.json(map);
}

// POST /api/known-words - Bulk update known words
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!Array.isArray(body.updates)) {
    return NextResponse.json({ error: 'updates array required' }, { status: 400 });
  }

  const lang = resolveLanguage(body.language);

  const stmt = db.prepare('INSERT OR REPLACE INTO knownWords (word, language, state) VALUES (?, ?, ?)');
  const transaction = db.transaction((updates: Array<{ word: string; state: string }>) => {
    for (const u of updates) {
      stmt.run(u.word.toLowerCase(), lang, u.state);
    }
  });

  transaction(body.updates);

  return NextResponse.json({ success: true, count: body.updates.length });
}
