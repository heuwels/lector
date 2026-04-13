import { Hono } from 'hono';
import { db, LessonRow } from '../db';

const app = new Hono();

// GET /api/lessons/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;

  if (!lesson) {
    return c.json({ error: 'Lesson not found' }, 404);
  }

  return c.json(lesson);
});

// PUT /api/lessons/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.textContent !== undefined) { updates.push('textContent = ?'); values.push(body.textContent); }
  if (body.sortOrder !== undefined) { updates.push('sortOrder = ?'); values.push(body.sortOrder); }
  if (body.collectionId !== undefined) { updates.push('collectionId = ?'); values.push(body.collectionId); }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/lessons/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
  return c.json({ success: true });
});

// PUT /api/lessons/:id/progress
app.put('/:id/progress', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id, collectionId FROM lessons WHERE id = ?').get(id) as { id: string; collectionId: string | null } | undefined;
  if (!existing) {
    return c.json({ error: 'Lesson not found' }, 404);
  }

  db.prepare(`
    UPDATE lessons SET
      progress_scrollPosition = ?,
      progress_percentComplete = ?,
      lastReadAt = ?
    WHERE id = ?
  `).run(body.scrollPosition ?? 0, body.percentComplete ?? 0, now, id);

  if (existing.collectionId) {
    db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ?').run(now, existing.collectionId);
  }

  return c.json({ success: true });
});

export default app;
