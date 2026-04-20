import { NextResponse } from 'next/server';
import { db } from '@/lib/server/database';

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// GET /api/stats/fluency - Get fluency benchmarks (word counts, CEFR level, growth)
export async function GET() {
  // Count words by state from knownWords table
  const stateCounts = db.prepare(
    'SELECT state, COUNT(*) as count FROM knownWords GROUP BY state'
  ).all() as { state: string; count: number }[];

  const countMap: Record<string, number> = {};
  for (const row of stateCounts) {
    countMap[row.state] = row.count;
  }

  const totalKnownWords = countMap['known'] || 0;
  const totalLearning =
    (countMap['level1'] || 0) +
    (countMap['level2'] || 0) +
    (countMap['level3'] || 0) +
    (countMap['level4'] || 0);
  const totalNew = countMap['new'] || 0;

  // Determine CEFR-style level
  const levels = [
    { min: 0, max: 500, code: 'A1', label: 'Beginner' },
    { min: 500, max: 1500, code: 'A2', label: 'Elementary' },
    { min: 1500, max: 3000, code: 'B1', label: 'Intermediate' },
    { min: 3000, max: 5000, code: 'B2', label: 'Upper Intermediate' },
    { min: 5000, max: 8000, code: 'C1', label: 'Advanced' },
    { min: 8000, max: Infinity, code: 'C2', label: 'Proficiency' },
  ];

  const currentLevel = levels.find(
    (l) => totalKnownWords >= l.min && totalKnownWords < l.max
  ) || levels[levels.length - 1];

  const progressToNextLevel =
    currentLevel.max === Infinity
      ? 100
      : Math.round(
          ((totalKnownWords - currentLevel.min) /
            (currentLevel.max - currentLevel.min)) *
            100
        );

  // Weekly growth: words marked known in last 7 days vs previous 7 days
  const today = getTodayDate();
  const d7 = new Date();
  d7.setDate(d7.getDate() - 6);
  const weekStart = d7.toISOString().split('T')[0];

  const d14 = new Date();
  d14.setDate(d14.getDate() - 13);
  const prevWeekStart = d14.toISOString().split('T')[0];

  const d8 = new Date();
  d8.setDate(d8.getDate() - 7);
  const prevWeekEnd = d8.toISOString().split('T')[0];

  const thisWeekRow = db.prepare(
    'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ?'
  ).get(weekStart, today) as { total: number };

  const prevWeekRow = db.prepare(
    'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ?'
  ).get(prevWeekStart, prevWeekEnd) as { total: number };

  return NextResponse.json({
    totalKnownWords,
    totalLearning,
    totalNew,
    estimatedLevel: {
      code: currentLevel.code,
      label: currentLevel.label,
    },
    progressToNextLevel,
    weeklyGrowth: {
      thisWeek: thisWeekRow.total,
      lastWeek: prevWeekRow.total,
      delta: thisWeekRow.total - prevWeekRow.total,
    },
  });
}
