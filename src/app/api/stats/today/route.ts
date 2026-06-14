import { NextRequest, NextResponse } from 'next/server';
import { db, DailyStatsRow } from '@/lib/server/database';
import { getTodayDate } from '@/lib/server/dates';

// GET /api/stats/today - Get today's stats
export async function GET() {
  const today = getTodayDate();
  let stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow | undefined;

  if (!stats) {
    // Create today's entry
    db.prepare(`
      INSERT INTO dailyStats (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
      VALUES (?, 0, 0, 0, 0, 0, 0, 0)
    `).run(today);

    stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow;
  }

  return NextResponse.json(stats);
}

// PUT /api/stats/today - Increment a stat
export async function PUT(request: NextRequest) {
  const today = getTodayDate();
  const body = await request.json();

  // Ensure today's entry exists
  db.prepare(`
    INSERT OR IGNORE INTO dailyStats (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);

  const field = body.field as string;
  const amount = body.amount ?? 1;

  const allowedFields = ['wordsRead', 'newWordsSaved', 'wordsMarkedKnown', 'minutesRead', 'clozePracticed', 'points', 'dictionaryLookups', 'ankiReviews'];
  if (!allowedFields.includes(field)) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 });
  }

  db.prepare(`UPDATE dailyStats SET ${field} = ${field} + ? WHERE date = ?`).run(amount, today);

  return NextResponse.json({ success: true });
}
