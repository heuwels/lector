import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';
import { resolveLanguage } from '../lib/active-language';

const app = new Hono();

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// GET /api/stats
app.get('/', (c) => {
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const days = c.req.query('days');

  let query = 'SELECT * FROM dailyStats';
  const params: string[] = [];

  if (startDate && endDate) {
    query += ' WHERE date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  } else if (days) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(days) + 1);
    const start = d.toISOString().split('T')[0];
    const end = new Date().toISOString().split('T')[0];
    query += ' WHERE date BETWEEN ? AND ?';
    params.push(start, end);
  }

  query += ' ORDER BY date ASC';

  const stats = db.prepare(query).all(...params) as DailyStatsRow[];
  return c.json(stats);
});

// GET /api/stats/today
app.get('/today', (c) => {
  const today = getTodayDate();
  let stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow | undefined;

  if (!stats) {
    db.prepare(`
      INSERT INTO dailyStats (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
      VALUES (?, 0, 0, 0, 0, 0, 0, 0)
    `).run(today);

    stats = db.prepare('SELECT * FROM dailyStats WHERE date = ?').get(today) as DailyStatsRow;
  }

  return c.json(stats);
});

// PUT /api/stats/today
app.put('/today', async (c) => {
  const today = getTodayDate();
  const body = await c.req.json();

  db.prepare(`
    INSERT OR IGNORE INTO dailyStats (date, wordsRead, newWordsSaved, wordsMarkedKnown, minutesRead, clozePracticed, points, dictionaryLookups)
    VALUES (?, 0, 0, 0, 0, 0, 0, 0)
  `).run(today);

  const field = body.field as string;
  const amount = body.amount ?? 1;

  const allowedFields = ['wordsRead', 'newWordsSaved', 'wordsMarkedKnown', 'minutesRead', 'clozePracticed', 'points', 'dictionaryLookups'];
  if (!allowedFields.includes(field)) {
    return c.json({ error: 'Invalid field' }, 400);
  }

  db.prepare(`UPDATE dailyStats SET ${field} = ${field} + ? WHERE date = ?`).run(amount, today);

  return c.json({ success: true });
});

// GET /api/stats/fluency
app.get('/fluency', (c) => {
  const lang = resolveLanguage(c.req.query('language'));

  // Count words by state from knownWords table
  const stateCounts = db.prepare(
    'SELECT state, COUNT(*) as count FROM knownWords WHERE language = ? GROUP BY state'
  ).all(lang) as { state: string; count: number }[];

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

  return c.json({
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
});

// GET /api/stats/streak
app.get('/streak', (c) => {
  const today = getTodayDate();

  const rows = db.prepare(
    'SELECT date, clozePracticed FROM dailyStats WHERE clozePracticed > 0 ORDER BY date DESC'
  ).all() as Pick<DailyStatsRow, 'date' | 'clozePracticed'>[];

  if (rows.length === 0) {
    return c.json({ streak: 0, practicedToday: false });
  }

  const practicedDates = new Set(rows.map(r => r.date));
  const practicedToday = practicedDates.has(today);

  let streak = 0;
  const checkDate = new Date(today + 'T12:00:00');

  if (practicedToday) {
    streak = 1;
    checkDate.setDate(checkDate.getDate() - 1);
  } else {
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterday = checkDate.toISOString().split('T')[0];
    if (!practicedDates.has(yesterday)) {
      return c.json({ streak: 0, practicedToday: false });
    }
  }

  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (practicedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return c.json({ streak, practicedToday });
});

export default app;
