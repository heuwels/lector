import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { lookupWord } from '@/lib/server/dictionary-db';
import { resolveLanguage } from '@/lib/server/active-language';

/**
 * GET /api/dictionary/lookup?word=<word>
 *
 * Returns `{ entry: ExpandedDictionaryEntry }` on a hit, `{ entry: null }`
 * on a miss (always 200). The miss case signals the caller to fall back to
 * the AI translate API. `400` is returned only for malformed input.
 *
 * Mirrors the `recordStudyPing()` side-effect from /api/translate so daily
 * dictionary-lookup stats stay accurate when the on-device DB serves a hit.
 */

function recordStudyPing() {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);
  db.prepare(`
    UPDATE dailyStats SET sessionStartedAt = COALESCE(sessionStartedAt, ?) WHERE date = ?
  `).run(now, today);
  db.prepare(`
    UPDATE dailyStats SET dictionaryLookups = dictionaryLookups + 1 WHERE date = ?
  `).run(today);
}

export async function GET(request: NextRequest) {
  try {
    const word = request.nextUrl.searchParams.get('word');
    if (!word || !word.trim()) {
      return NextResponse.json({ error: 'Word is required' }, { status: 400 });
    }

    const lang = resolveLanguage(request.nextUrl.searchParams.get('language'));
    const entry = lookupWord(word.trim(), lang);
    if (entry) recordStudyPing();

    return NextResponse.json({ entry: entry ?? null });
  } catch (error) {
    console.error('Dictionary lookup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lookup failed' },
      { status: 500 },
    );
  }
}
