import { NextResponse } from 'next/server';
import { db, DailyStatsRow } from '@/lib/server/database';

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// GET /api/stats/streak - Get current practice streak
export async function GET() {
  const today = getTodayDate();

  // Get all daily stats ordered by date descending
  const rows = db.prepare(
    'SELECT date, clozePracticed FROM dailyStats WHERE clozePracticed > 0 ORDER BY date DESC'
  ).all() as Pick<DailyStatsRow, 'date' | 'clozePracticed'>[];

  if (rows.length === 0) {
    return NextResponse.json({ streak: 0, practicedToday: false });
  }

  const practicedDates = new Set(rows.map(r => r.date));
  const practicedToday = practicedDates.has(today);

  // Count consecutive days backwards from today (or yesterday if not practiced today)
  let streak = 0;
  const checkDate = new Date(today + 'T12:00:00'); // noon to avoid DST issues

  if (practicedToday) {
    streak = 1;
    checkDate.setDate(checkDate.getDate() - 1);
  } else {
    // Check if yesterday had practice — if not, streak is 0
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterday = checkDate.toISOString().split('T')[0];
    if (!practicedDates.has(yesterday)) {
      return NextResponse.json({ streak: 0, practicedToday: false });
    }
  }

  // Count backwards
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (practicedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return NextResponse.json({ streak, practicedToday });
}
