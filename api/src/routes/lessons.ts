import { Hono } from 'hono';
import { db, LessonRow } from '../db';
import { countWords } from '../lib/html-to-markdown';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';

const app = new Hono();

// GET /api/lessons/:id
// By-id routes scope to the active language (defense-in-depth): a stale
// cross-language id 404s rather than reading/mutating another language's lesson.
app.get('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  const lesson = db
    .prepare('SELECT * FROM lessons WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as LessonRow | undefined;

  if (!lesson) {
    return c.json({ error: 'Lesson not found' }, 404);
  }

  return c.json(lesson);
});

// PUT /api/lessons/:id
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.textContent !== undefined) {
    updates.push('textContent = ?');
    values.push(body.textContent);
    updates.push('wordCount = ?');
    values.push(countWords(body.textContent));
  }
  if (body.sortOrder !== undefined) { updates.push('sortOrder = ?'); values.push(body.sortOrder); }
  if (body.collectionId !== undefined) { updates.push('collectionId = ?'); values.push(body.collectionId); }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);
  values.push(userId);
  values.push(resolveLanguage(c.req.query('language')));

  db.prepare(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/lessons/:id
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  db.prepare('DELETE FROM lessons WHERE id = ? AND userId = ? AND language = ?').run(id, userId, lang);
  return c.json({ success: true });
});

// PUT /api/lessons/:id/progress
app.put('/:id/progress', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'));
  const body = await c.req.json();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id, collectionId FROM lessons WHERE id = ? AND userId = ? AND language = ?').get(id, userId, lang) as { id: string; collectionId: string | null } | undefined;
  if (!existing) {
    return c.json({ error: 'Lesson not found' }, 404);
  }

  db.prepare(`
    UPDATE lessons SET
      progress_scrollPosition = ?,
      progress_percentComplete = ?,
      lastReadAt = ?
    WHERE id = ? AND userId = ? AND language = ?
  `).run(body.scrollPosition ?? 0, body.percentComplete ?? 0, now, id, userId, lang);

  if (existing.collectionId) {
    db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ? AND userId = ?').run(now, existing.collectionId, userId);
  }

  return c.json({ success: true });
});

export default app;
