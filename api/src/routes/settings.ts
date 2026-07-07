import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import { db, SettingRow } from '../db';

const SENSITIVE_KEYS = new Set(['anthropicApiKey', 'claudeOauthToken', 'lmstudioApiKey', 'openaiApiKey']);

const app = new Hono();

// GET /api/settings
app.get('/', (c) => {
  const settings = db.prepare('SELECT * FROM settings WHERE userId = ?').all(getCurrentUserId(c)) as SettingRow[];
  const result: Record<string, unknown> = {};
  for (const s of settings) {
    if (SENSITIVE_KEYS.has(s.key)) {
      result[s.key] = true;
      continue;
    }
    try {
      result[s.key] = JSON.parse(s.value);
    } catch {
      result[s.key] = s.value;
    }
  }
  return c.json(result);
});

// PUT /api/settings
app.put('/', async (c) => {
  const body = await c.req.json();

  const userId = getCurrentUserId(c);
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      stmt.run(userId, key, JSON.stringify(value));
    }
  })();

  return c.json({ success: true });
});

// GET /api/settings/:key
app.get('/:key', (c) => {
  const key = c.req.param('key');
  const setting = db.prepare('SELECT value FROM settings WHERE userId = ? AND key = ?').get(getCurrentUserId(c), key) as SettingRow | undefined;

  if (!setting) return c.json(null);

  if (SENSITIVE_KEYS.has(key)) {
    return c.json(true);
  }

  try {
    return c.json(JSON.parse(setting.value));
  } catch {
    return c.json(setting.value);
  }
});

// PUT /api/settings/:key
app.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();

  db.prepare('INSERT OR REPLACE INTO settings (userId, key, value) VALUES (?, ?, ?)').run(getCurrentUserId(c), key, JSON.stringify(body.value));

  return c.json({ success: true });
});

// DELETE /api/settings/:key
app.delete('/:key', (c) => {
  const key = c.req.param('key');
  db.prepare('DELETE FROM settings WHERE userId = ? AND key = ?').run(getCurrentUserId(c), key);
  return c.json({ success: true });
});

export default app;
