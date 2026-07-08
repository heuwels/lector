import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getTodayDate, addDaysToDateString } from '../lib/dates';
import { activeDateSet, computeStreaks } from '../lib/streak';
import { deriveReadingStats } from '../lib/stats-derive';
import { deriveCefrProgress } from '../lib/cefr';
import { deriveDomainFluency, type DomainStateRow } from '../lib/domains';

const app = new Hono();

// GET /api/stats
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const days = c.req.query('days');

  let query = 'SELECT * FROM dailyStats WHERE userId = ? AND language = ?';
  const params: string[] = [userId, lang];

  if (startDate && endDate) {
    query += ' AND date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (days) {
    const end = getTodayDate(userId);
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
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const today = getTodayDate(userId);
  let stats = db
    .prepare('SELECT * FROM dailyStats WHERE userId = ? AND date = ? AND language = ?')
    .get(userId, today, lang) as DailyStatsRow | undefined;

  if (!stats) {
    db.prepare(
      `
      INSERT INTO dailyStats (userId, date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
      VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
    `,
    ).run(userId, today, lang);

    stats = db
      .prepare('SELECT * FROM dailyStats WHERE userId = ? AND date = ? AND language = ?')
      .get(userId, today, lang) as DailyStatsRow;
  }

  return c.json(stats);
});

// PUT /api/stats/today
app.put('/today', async (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const today = getTodayDate(userId);
  const body = await c.req.json();

  db.prepare(
    `
    INSERT OR IGNORE INTO dailyStats (userId, date, language, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
  `,
  ).run(userId, today, lang);

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

  db.prepare(`UPDATE dailyStats SET ${field} = ${field} + ? WHERE userId = ? AND date = ? AND language = ?`).run(
    amount,
    userId,
    today,
    lang,
  );

  return c.json({ success: true });
});

// GET /api/stats/fluency
app.get('/fluency', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);

  // Count words by state from knownWords table
  const stateCounts = db
    .prepare('SELECT state, COUNT(*) as count FROM knownWords WHERE userId = ? AND language = ? GROUP BY state')
    .all(userId, lang) as { state: string; count: number }[];

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
  const today = getTodayDate(userId);
  const weekStart = addDaysToDateString(today, -6);
  const prevWeekStart = addDaysToDateString(today, -13);
  const prevWeekEnd = addDaysToDateString(today, -7);

  const thisWeekRow = db
    .prepare(
      'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE userId = ? AND date BETWEEN ? AND ? AND language = ?',
    )
    .get(userId, weekStart, today, lang) as { total: number };

  const prevWeekRow = db
    .prepare(
      'SELECT COALESCE(SUM(wordsMarkedKnown), 0) as total FROM dailyStats WHERE userId = ? AND date BETWEEN ? AND ? AND language = ?',
    )
    .get(userId, prevWeekStart, prevWeekEnd, lang) as { total: number };

  // Per-domain fluency (radar): grouped knownWords counts → axes + a pending
  // count. Aggregated from knownWords (one row per word/language) so it
  // reconciles with totalKnownWords above; the maths lives in deriveDomainFluency.
  const domainRows = db
    .prepare(
      'SELECT domain, state, COUNT(*) as count FROM knownWords WHERE userId = ? AND language = ? GROUP BY domain, state',
    )
    .all(userId, lang) as DomainStateRow[];
  const { byDomain, pending } = deriveDomainFluency(domainRows);

  return c.json({
    totalKnownWords,
    totalLearning,
    totalNew,
    byState,
    byDomain,
    pending,
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
  const userId = getCurrentUserId(c);
  const today = getTodayDate(userId);

  // App-wide across languages, but strictly one user's rows.
  const rows = db
    .prepare(
      'SELECT date, dictionaryLookups, clozePracticed, minutesRead, ankiReviews FROM dailyStats WHERE userId = ?',
    )
    .all(userId) as Pick<
    DailyStatsRow,
    'date' | 'dictionaryLookups' | 'clozePracticed' | 'minutesRead' | 'ankiReviews'
  >[];

  const { current, longest, activeToday } = computeStreaks(activeDateSet(rows), today);

  return c.json({ streak: current, longest, practicedToday: activeToday });
});

// GET /api/stats/activity
// App-wide daily activity for the heatmap — the same deliberately-unscoped
// stance as /streak (#238): a day studied only in language X must render as an
// active cell under language Y, or the heatmap contradicts the streak shown
// beside it. SUMs per date across languages, one user's rows only.
// ankiReviews is included because the streak's isActiveDay counts it —
// excluding it would re-create the disagreement for Anki-only days. (Its
// per-language attribution quirk is CORRECTNESS-11, a separate issue; it can
// inflate cell intensity, never active/inactive agreement.)
app.get('/activity', (c) => {
  const userId = getCurrentUserId(c);
  const rows = db
    .prepare(
      `SELECT date,
        SUM(dictionaryLookups) as dictionaryLookups,
        SUM(clozePracticed) as clozePracticed,
        SUM(minutesRead) as minutesRead,
        SUM(ankiReviews) as ankiReviews
      FROM dailyStats
      WHERE userId = ?
      GROUP BY date
      ORDER BY date ASC`,
    )
    .all(userId);
  return c.json(rows);
});

// GET /api/stats/reading
// Estimated reading volume derived from per-lesson scroll progress, scoped to the
// active language: the stats page is a per-language dashboard (fluency, daily
// stats and collection counts are all per-language), so reading volume reads as
// "how much of THIS language you've read". Streak remains the one deliberately
// app-wide metric (see /streak).
app.get('/reading', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);
  const rows = db
    .prepare('SELECT wordCount, progress_percentComplete AS percentComplete FROM lessons WHERE userId = ? AND language = ?')
    .all(userId, lang) as { wordCount: number; percentComplete: number }[];

  return c.json(deriveReadingStats(rows));
});

export default app;
