import { NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { deriveReadingStats } from '@/lib/stats-derive';

// GET /api/stats/reading - Estimated reading volume derived from per-lesson
// scroll progress. This is an estimate, not a tracked count — see
// deriveReadingStats for why. Not language-scoped: lessons carry no language
// column, so this reflects the whole library.
export async function GET() {
  const rows = db
    .prepare('SELECT wordCount, progress_percentComplete AS percentComplete FROM lessons')
    .all() as { wordCount: number; percentComplete: number }[];

  return NextResponse.json(deriveReadingStats(rows));
}
