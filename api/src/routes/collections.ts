import { Hono } from 'hono';
import { db, CollectionRow, LessonRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { randomUUID } from 'crypto';
import { countWords } from '../lib/html-to-markdown';

const app = new Hono();

// GET /api/collections
app.get('/', (c) => {
  const lang = resolveLanguage(c.req.query('language'));

  const collections = db.prepare(`
    SELECT c.*, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN lessons l ON l.collectionId = c.id AND l.language = c.language
    WHERE c.language = ?
    GROUP BY c.id
    ORDER BY c.lastReadAt DESC
  `).all(lang) as (CollectionRow & { lessonCount: number; avgProgress: number })[];

  return c.json(collections);
});

// POST /api/collections
app.post('/', async (c) => {
  const body = await c.req.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();
  const lang = resolveLanguage(body.language);

  db.prepare(`
    INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.title, body.author || 'Unknown', body.coverUrl || null, lang, now, now);

  return c.json({ id });
});

// GET /api/collections/:id
app.get('/:id', (c) => {
  const id = c.req.param('id');
  const collection = db.prepare(`
    SELECT c.*, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN lessons l ON l.collectionId = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id) as (CollectionRow & { lessonCount: number; avgProgress: number }) | undefined;

  if (!collection) {
    return c.json({ error: 'Collection not found' }, 404);
  }

  return c.json(collection);
});

// PUT /api/collections/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.author !== undefined) { updates.push('author = ?'); values.push(body.author); }
  if (body.coverUrl !== undefined) { updates.push('coverUrl = ?'); values.push(body.coverUrl); }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE collections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/collections/:id
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM lessons WHERE collectionId = ?').run(id);
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  return c.json({ success: true });
});

// GET /api/collections/:id/lessons
app.get('/:id/lessons', (c) => {
  const id = c.req.param('id');
  const lessons = db.prepare(`
    SELECT id, collectionId, title, sortOrder, progress_scrollPosition,
      progress_percentComplete, wordCount, createdAt, lastReadAt
    FROM lessons
    WHERE collectionId = ?
    ORDER BY sortOrder ASC
  `).all(id) as Omit<LessonRow, 'textContent'>[];

  return c.json(lessons);
});

// POST /api/collections/:id/lessons
app.post('/:id/lessons', async (c) => {
  const collectionId = c.req.param('id');
  const body = await c.req.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM lessons WHERE collectionId = ?'
  ).get(collectionId) as { maxOrder: number };

  const textContent = body.textContent || '';

  db.prepare(`
    INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, createdAt, lastReadAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, collectionId, body.title, maxOrder.maxOrder + 1, textContent, countWords(textContent), now, now);

  db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ?').run(now, collectionId);

  return c.json({ id });
});

export default app;
