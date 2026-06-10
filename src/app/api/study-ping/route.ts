import { NextResponse } from 'next/server';
import { db, DailyStatsRow } from '@/lib/server/database';
import { getTodayDate } from '@/lib/server/dates';

// GET /api/study-ping
// Returns whether any language study happened today.
// Intended for Sphere Guardian MCP to poll.
export async function GET() {
  const today = getTodayDate();
  const stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow | undefined;

  const done = stats
    ? stats.dictionaryLookups > 0 || stats.minutesRead > 0 || stats.clozePracticed > 0
    : false;

  return NextResponse.json({
    done,
    date: today,
    minutes: stats?.minutesRead ?? 0,
    lookups: stats?.dictionaryLookups ?? 0,
    clozePracticed: stats?.clozePracticed ?? 0,
    sessionStartedAt: stats?.sessionStartedAt ?? null,
  });
}

// POST /api/study-ping
// Called automatically on the first word lookup or page turn of a session.
// Records the session start time (once per day).
export async function POST() {
  const today = getTodayDate();
  const now = new Date().toISOString();

  // Ensure today's stats row exists
  db.prepare(`
    INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);

  // Record session start only once per day
  db.prepare(`
    UPDATE dailyStats
    SET sessionStartedAt = COALESCE(sessionStartedAt, ?)
    WHERE date = ?
  `).run(now, today);

  const stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow;

  return NextResponse.json({
    done: true,
    date: today,
    minutes: stats.minutesRead,
    lookups: stats.dictionaryLookups,
    sessionStartedAt: stats.sessionStartedAt,
  });
}
