import { NextResponse } from 'next/server';
import { db, DailyStatsRow } from '@/lib/server/database';
import { getTodayDate } from '@/lib/server/dates';
import { activeDateSet, computeStreaks } from '@/lib/streak';

// GET /api/stats/streak - Current and longest study streak.
//
// One streak definition for the whole app (issue #108): a day is active when
// it has any study activity (dictionary lookups, cloze practice, or reading
// time), with day rollover in the configured time zone. The home page and
// stats page both render from this endpoint instead of computing their own.
export async function GET() {
  const today = getTodayDate();

  const rows = db.prepare(
    'SELECT date, dictionaryLookups, clozePracticed, minutesRead FROM dailyStats'
  ).all() as Pick<DailyStatsRow, 'date' | 'dictionaryLookups' | 'clozePracticed' | 'minutesRead'>[];

  const { current, longest, activeToday } = computeStreaks(activeDateSet(rows), today);

  return NextResponse.json({ streak: current, longest, practicedToday: activeToday });
}
