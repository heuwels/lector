import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { resolveLanguage } from '@/lib/server/active-language';
import { getTodayDate } from '@/lib/server/dates';
import { addDaysToDateString } from '@/lib/dates';
import {
  DOMAINS,
  masteryScore,
  axisValue,
  bandFor,
  type DomainStateCounts,
  type WeightedState,
} from '@/lib/domains';

// GET /api/stats/fluency - Get fluency benchmarks (word counts, CEFR level, growth)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = resolveLanguage(searchParams.get('language'));

  // Count words by state from knownWords table
  const stateCounts = db.prepare(
    'SELECT state, COUNT(*) as count FROM knownWords WHERE language = ? GROUP BY state'
  ).all(lang) as { state: string; count: number }[];

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
  const totalLearning =
    byState.level1 + byState.level2 + byState.level3 + byState.level4;
  const totalNew = byState.new;

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
  const weekStart = addDaysToDateString(today, -6);
  const prevWeekStart = addDaysToDateString(today, -13);
  const prevWeekEnd = addDaysToDateString(today, -7);

  const thisWeekRow = db.prepare(
    'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ? AND language = ?'
  ).get(weekStart, today, lang) as { total: number };

  const prevWeekRow = db.prepare(
    'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE date BETWEEN ? AND ? AND language = ?'
  ).get(prevWeekStart, prevWeekEnd, lang) as { total: number };

  // ── Per-domain fluency (radar) ────────────────────────────────────────────
  // Aggregated from knownWords — one row per unique word/language — so the radar
  // reconciles with the global known count above by construction. Deliberately
  // NOT from vocab, which holds many rows per word and would double-count.
  const domainRows = db.prepare(
    'SELECT domain, state, COUNT(*) as count FROM knownWords WHERE language = ? GROUP BY domain, state'
  ).all(lang) as { domain: string | null; state: string; count: number }[];

  const masteryStates: ReadonlySet<string> = new Set(['level1', 'level2', 'level3', 'level4', 'known']);
  const countsByDomain: Record<string, DomainStateCounts> = {};
  // Mastery-state words the worker hasn't classified yet (domain IS NULL). Drains
  // to 0 as it runs; surfaced so a fresh import reads as "in progress", not wrong.
  let pending = 0;
  for (const row of domainRows) {
    if (row.domain === null) {
      if (masteryStates.has(row.state)) pending += row.count;
      continue; // 'general' words have a (non-null) domain → classified, just not an axis
    }
    (countsByDomain[row.domain] ||= {})[row.state as WeightedState] = row.count;
  }

  // One entry per fixed axis (stable radar shape); 'general' is intentionally
  // absent — it would dominate every domain. axisValue/band come from the shared
  // pure helper so the maths matches the unit-tested module exactly.
  const byDomain = DOMAINS.map((d) => {
    const counts = countsByDomain[d.key] || {};
    const mastery = masteryScore(counts);
    const axis = axisValue(mastery);
    return {
      domain: d.key,
      label: d.label,
      knownCount: counts.known || 0,
      masteryScore: Math.round(mastery * 100) / 100,
      axisValue: axis,
      band: bandFor(axis),
    };
  });

  return NextResponse.json({
    totalKnownWords,
    totalLearning,
    totalNew,
    byState,
    byDomain,
    pending,
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
