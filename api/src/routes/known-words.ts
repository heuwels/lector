import { Hono } from 'hono';
import { db, KnownWordRow } from '../db';
import { resolveLanguage } from '../lib/active-language';

const app = new Hono();

// GET /api/known-words - all known words as a word -> state map
app.get('/', (c) => {
  const lang = resolveLanguage(c.req.query('language'));

  const words = db.prepare('SELECT * FROM knownWords WHERE language = ?').all(lang) as KnownWordRow[];
  const map: Record<string, string> = {};
  for (const w of words) {
    map[w.word] = w.state;
  }
  return c.json(map);
});

// POST /api/known-words - bulk update known words
app.post('/', async (c) => {
  const body = await c.req.json();

  if (!Array.isArray(body.updates)) {
    return c.json({ error: 'updates array required' }, 400);
  }

  const lang = resolveLanguage(body.language);

  const stmt = db.prepare('INSERT OR REPLACE INTO knownWords (word, language, state) VALUES (?, ?, ?)');
  db.transaction((updates: Array<{ word: string; state: string }>) => {
    for (const u of updates) {
      stmt.run(u.word.toLowerCase(), lang, u.state);
    }
  })(body.updates);

  return c.json({ success: true, count: body.updates.length });
});

export default app;
