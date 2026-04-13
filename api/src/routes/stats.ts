import { Hono } from 'hono';
import { db, DailyStatsRow } from '../db';

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
