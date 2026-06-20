import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { getTodayDate } from '@/lib/server/dates';
import { addDaysToDateString } from '@/lib/dates';
import { deriveCefrProgress } from '@/lib/cefr';

// GET /api/stats/fluency - Get fluency benchmarks (word counts, CEFR level, growth)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));

  // Count words by state from knownWords table
  const stateCounts = db
    .prepare('SELECT state, COUNT(*) as count FROM knownWords WHERE language = ? GROUP BY state')
    .all(lang) as { state: string; count: number }[];

  const countMap: Record<string, number> = {};
  for (const row of stateCounts) {
    countMap[row.state] = row.count;
  }

  const byState = {
    new: countMap['new'] || 0,
    level1: countMap['level1'] || 0,
    level2: countMap['level2'] || 0,
    level3: countMap['level3'] || 0,
    level4: countMap['level4'] || 0,
    known: countMap['known'] || 0,
    ignored: countMap['ignored'] || 0,
  };

  const totalKnownWords = byState.known;
  const totalLearning = byState.level1 + byState.level2 + byState.level3 + byState.level4;
  const totalNew = byState.new;

  // Determine CEFR-style level + progress through the current band.
  const { estimatedLevel, nextLevel, progressToNextLevel, wordsToNextLevel } =
    deriveCefrProgress(totalKnownWords);

  // Weekly growth: words marked known in last 7 days vs previous 7 days
  const today = getTodayDate();
  const weekStart = addDaysToDateString(today, -6);
  const prevWeekStart = addDaysToDateString(today, -13);
  const prevWeekEnd = addDaysToDateString(today, -7);

  const thisWeekRow = db
    .prepare(
      'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ? AND language = ?',
    )
    .get(weekStart, today, lang) as { total: number };

  const prevWeekRow = db
    .prepare(
      'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ? AND language = ?',
    )
    .get(prevWeekStart, prevWeekEnd, lang) as { total: number };

  return NextResponse.json({
    totalKnownWords,
    totalLearning,
    totalNew,
    byState,
    estimatedLevel,
    nextLevel,
    progressToNextLevel,
    wordsToNextLevel,
    weeklyGrowth: {
      thisWeek: thisWeekRow.total,
      lastWeek: prevWeekRow.total,
      delta: thisWeekRow.total - prevWeekRow.total,
    },
  });
}
