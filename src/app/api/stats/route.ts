import { NextRequest, NextResponse } from 'next/server';
import { db, DailyStatsRow, VocabRow } from '@/lib/server/database';
import { getTodayDate } from '@/lib/server/dates';
import { addDaysToDateString } from '@/lib/dates';

// GET /api/stats - Get stats for date range
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const days = searchParams.get('days');

  let query = 'SELECT * FROM dailyStats';
  const params: string[] = [];

  if (startDate && endDate) {
    query += ' WHERE date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (days) {
    const end = getTodayDate();
    const start = addDaysToDateString(end, -(parseInt(days) - 1));
    query += ' WHERE date BETWEEN ? AND ?';
    params.push(start, end);
  }

  query += ' ORDER BY date ASC';

  const stats = db.prepare(query).all(...params) as DailyStatsRow[];
  return NextResponse.json(stats);
}
