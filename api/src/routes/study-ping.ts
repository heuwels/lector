import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';

const app = new Hono();

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// GET /api/study-ping
app.get('/', (c) => {
  const today = getTodayDate();
  const stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow | undefined;

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
app.post('/', (c) => {
  const today = getTodayDate();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO dailyStats
      (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);

  db.prepare(`
    UPDATE dailyStats
    SET sessionStartedAt = COALESCE(sessionStartedAt, ?)
    WHERE date = ?
  `).run(now, today);

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
