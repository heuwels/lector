import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getTodayDate, addDaysToDateString } from '../lib/dates';
import { activeDateSet, computeStreaks } from '../lib/streak';
import { deriveReadingStats } from '../lib/stats-derive';
import { deriveCefrProgress } from '../lib/cefr';

const app = new Hono();

// GET /api/stats
app.get('/', (c) => {
  const lang = resolveLanguage(c.req.query('language'));
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const days = c.req.query('days');

  let query = 'SELECT * FROM dailyStats WHERE language = ?';
  const params: string[] = [lang];

  if (startDate && endDate) {
    query += ' AND date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (days) {
    const end = getTodayDate();
    const start = addDaysToDateString(end, -(parseInt(days) - 1));
    query += ' AND date BETWEEN ? AND ?';
    params.push(start, end);
  }

  query += ' ORDER BY date ASC';

  const stats = db.prepare(query).all(...params) as DailyStatsRow[];
  return c.json(stats);
});

// GET /api/stats/today
app.get('/today', (c) => {
  const lang = resolveLanguage(c.req.query('language'));
  const today = getTodayDate();
  let stats = db
    .prepare('SELECT * FROM dailyStats WHERE date = ? AND language = ?')
    .get(today, lang) as DailyStatsRow | undefined;

  if (!stats) {
    db.prepare(
      `
      INSERT INTO dailyStats (date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
      VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)
    `,
    ).run(today, lang);

    stats = db
      .prepare('SELECT * FROM dailyStats WHERE date = ? AND language = ?')
      .get(today, lang) as DailyStatsRow;
  }

  return c.json(stats);
});

// PUT /api/stats/today
app.put('/today', async (c) => {
  const lang = resolveLanguage(c.req.query('language'));
  const today = getTodayDate();
  const body = await c.req.json();

  db.prepare(
    `
    INSERT OR IGNORE INTO dailyStats (date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0)
  `,
  ).run(today, lang);

  const field = body.field as string;
  const amount = body.amount ?? 1;

  const allowedFields = [
    'wordsRead',
    'newWordsSaved',
    'wordsMarkedKnown',
    'minutesRead',
    'clozePracticed',
    'points',
    'dictionaryLookups',
    'ankiReviews',
  ];
  if (!allowedFields.includes(field)) {
    return c.json({ error: 'Invalid field' }, 400);
  }

  db.prepare(`UPDATE dailyStats SET ${field} = ${field} + ? WHERE date = ? AND language = ?`).run(
    amount,
    today,
    lang,
  );

  return c.json({ success: true });
});

// GET /api/stats/fluency
app.get('/fluency', (c) => {
  const lang = resolveLanguage(c.req.query('language'));

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

  return c.json({
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
});

// GET /api/stats/streak
// Unified streak definition (issue #108): a day is active when it has any
// study activity (lookups, practice, reading time, or Anki reviews), with day
// rollover in the configured time zone. Keep in sync with src/app/api/stats/streak.
//
// Deliberately NOT language-scoped: the streak is one app-wide value (see
// CLAUDE.md "One streak definition app-wide"). A day you studied only language X
// must still count toward the streak you see under language Y, so we aggregate
// every dailyStats row regardless of language. Do NOT add a `language` filter
// here when partitioning other stats — that silently breaks multi-language
// streaks (the deleted Next route had no filter).
app.get('/streak', (c) => {
  const today = getTodayDate();

  const rows = db
    .prepare(
      'SELECT date, dictionaryLookups, clozePracticed, minutesRead, ankiReviews FROM dailyStats',
    )
    .all() as Pick<
    DailyStatsRow,
    'date' | 'dictionaryLookups' | 'clozePracticed' | 'minutesRead' | 'ankiReviews'
  >[];

  const { current, longest, activeToday } = computeStreaks(activeDateSet(rows), today);

  return c.json({ streak: current, longest, practicedToday: activeToday });
});

// GET /api/stats/reading
// Estimated reading volume derived from per-lesson scroll progress. Not
// language-scoped: it reflects the whole library (mirrors the Next route this
// replaces — lessons are aggregated regardless of language).
app.get('/reading', (c) => {
  const rows = db
    .prepare('SELECT wordCount, progress_percentComplete AS percentComplete FROM lessons')
    .all() as { wordCount: number; percentComplete: number }[];

  return c.json(deriveReadingStats(rows));
});

export default app;
