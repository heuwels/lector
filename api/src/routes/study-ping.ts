import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';
import { getTodayDate } from '../lib/dates';

const app = new Hono();

// GET /api/study-ping
// Returns whether any language study happened today. Intended for the Sphere
// Guardian MCP to poll. Language-agnostic (mirrors the Next route).
app.get('/', (c) => {
  const today = getTodayDate();
  const stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as
    | DailyStatsRow
    | undefined;

  const done = stats
    ? stats.dictionaryLookups > 0 || stats.minutesRead > 0 || stats.clozePracticed > 0
    : false;

  return c.json({
    done,
    date: today,
    minutes: stats?.minutesRead ?? 0,
    lookups: stats?.dictionaryLookups ?? 0,
    clozePracticed: stats?.clozePracticed ?? 0,
    sessionStartedAt: stats?.sessionStartedAt ?? null,
  });
});

// POST /api/study-ping
// Called on the first word lookup or page turn of a session; records the
// session start time once per day.
app.post('/', (c) => {
  const today = getTodayDate();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0)`,
  ).run(today);

  db.prepare('UPDATE dailyStats SET sessionStartedAt = COALESCE(sessionStartedAt, ?) WHERE date = ?').run(
    now,
    today,
  );

  const stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow;

  return c.json({
    done: true,
    date: today,
    minutes: stats.minutesRead,
    lookups: stats.dictionaryLookups,
    sessionStartedAt: stats.sessionStartedAt,
  });
});

export default app;
