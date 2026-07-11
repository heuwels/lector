import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, CollectionRow, LessonRow } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { randomUUID } from 'crypto';
import { countWords } from '../lib/html-to-markdown';
import { normalizeText } from '../lib/languages';
import { entitlements, planLimitResponse } from '../lib/entitlements';

const app = new Hono();

// GET /api/collections
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const lang = resolveLanguage(c.req.query('language'), userId);

  const collections = db.prepare(`
    SELECT c.*, g.name as groupName, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN collection_groups g ON g.id = c.groupId AND g.userId = c.userId
    LEFT JOIN lessons l ON l.collectionId = c.id AND l.language = c.language AND l.userId = c.userId
    WHERE c.userId = ? AND c.language = ?
    GROUP BY c.id
    ORDER BY c.sortOrder ASC, c.lastReadAt DESC
  `).all(userId, lang) as (CollectionRow & { groupName: string | null; lessonCount: number; avgProgress: number })[];

  return c.json(collections);
});

// POST /api/collections
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();
  const lang = resolveLanguage(body.language, userId);

  // Library size (#222): count + insert atomically so two concurrent creates
  // can't both slip past the cap — the check used to run before the
  // `await c.req.json()`, leaving a race window (#222 review).
  const verdict = entitlements.reserveCount(userId, [{ metric: 'maxCollections' }], () => {
    db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, groupId, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.title, body.author || 'Unknown', body.coverUrl || null, body.groupId || null, lang, now, now, userId);
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ id });
});

// PUT /api/collections/reorder
// Body: { ids: string[] } — collections (typically one group's worth) in their
// new order; sortOrder is set to the array index. Registered before /:id so
// "reorder" isn't captured as a collection id.
app.put('/reorder', async (c) => {
  const userId = getCurrentUserId(c);
  const body = await c.req.json();
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
    return c.json({ error: 'ids must be an array of strings' }, 400);
  }

  const update = db.prepare('UPDATE collections SET sortOrder = ? WHERE id = ? AND userId = ?');
  db.transaction((orderedIds: string[]) => {
    orderedIds.forEach((id, index) => update.run(index, id, userId));
  })(ids);

  return c.json({ success: true });
});

// GET /api/collections/:id
// By-id routes scope to the active language (defense-in-depth): a stale
// cross-language id 404s rather than reading/mutating another language's row.
app.get('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const collection = db.prepare(`
    SELECT c.*, COUNT(l.id) as lessonCount,
      COALESCE(AVG(l.progress_percentComplete), 0) as avgProgress
    FROM collections c
    LEFT JOIN lessons l ON l.collectionId = c.id AND l.language = c.language AND l.userId = c.userId
    WHERE c.id = ? AND c.userId = ? AND c.language = ?
    GROUP BY c.id
  `).get(id, userId, lang) as (CollectionRow & { lessonCount: number; avgProgress: number }) | undefined;

  if (!collection) {
    return c.json({ error: 'Collection not found' }, 404);
  }

  return c.json(collection);
});

// PUT /api/collections/:id
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const body = await c.req.json();

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.author !== undefined) { updates.push('author = ?'); values.push(body.author); }
  if (body.coverUrl !== undefined) { updates.push('coverUrl = ?'); values.push(body.coverUrl); }
  if (body.groupId !== undefined) { updates.push('groupId = ?'); values.push(body.groupId); }

  // Only bump lastReadAt for content changes, not metadata-only ones like groupId.
  const isContentChange =
    body.title !== undefined || body.author !== undefined || body.coverUrl !== undefined;
  if (isContentChange) {
    updates.push('lastReadAt = ?');
    values.push(new Date().toISOString());
  }
  // Guard the empty-update case: a body with no recognized fields would otherwise
  // build `SET  WHERE …` (a syntax error). Matches the cloze PUT handler.
  if (updates.length > 0) {
    values.push(id);
    values.push(userId);
    values.push(lang);
    db.prepare(`UPDATE collections SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`).run(...values);
  }

  return c.json({ success: true });
});

// DELETE /api/collections/:id
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  db.prepare('DELETE FROM lessons WHERE collectionId = ? AND userId = ? AND language = ?').run(id, userId, lang);
  db.prepare('DELETE FROM collections WHERE id = ? AND userId = ? AND language = ?').run(id, userId, lang);
  return c.json({ success: true });
});

// GET /api/collections/:id/lessons
app.get('/:id/lessons', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lessons = db.prepare(`
    SELECT id, collectionId, title, sortOrder, progress_scrollPosition,
      progress_percentComplete, wordCount, createdAt, lastReadAt
    FROM lessons
    WHERE collectionId = ? AND userId = ?
    ORDER BY sortOrder ASC
  `).all(id, userId) as Omit<LessonRow, 'textContent'>[];

  return c.json(lessons);
});

// POST /api/collections/:id/lessons
app.post('/:id/lessons', async (c) => {
  const userId = getCurrentUserId(c);
  const collectionId = c.req.param('id');
  const body = await c.req.json();
  const id = body.id || randomUUID();
  const now = new Date().toISOString();

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM lessons WHERE collectionId = ? AND userId = ?'
  ).get(collectionId, userId) as { maxOrder: number };

  // A lesson inherits its parent collection's language so it matches the
  // l.language = c.language join in the library list; fall back to the active
  // language if the collection is somehow missing.
  const parent = db.prepare('SELECT language FROM collections WHERE id = ? AND userId = ?').get(collectionId, userId) as
    | { language: string }
    | undefined;
  const language = parent?.language ?? resolveLanguage(c.req.query('language'), userId);

  // Text ingress (#289): pasted lesson text gets NFC'd like every other
  // import path, so reader tokens match dictionary and vocab keys.
  const textContent = normalizeText(body.textContent || '');

  // Library size (#222): count + insert atomically so concurrent lesson adds
  // can't both slip past the cap (#222 review).
  const verdict = entitlements.reserveCount(userId, [{ metric: 'maxLessons' }], () => {
    db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, collectionId, normalizeText(body.title || ''), maxOrder.maxOrder + 1, textContent, countWords(textContent), language, now, now, userId);

    db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ? AND userId = ?').run(now, collectionId, userId);
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ id });
});

// PUT /api/collections/:id/lessons/reorder
// Body: { ids: string[] } — the collection's lessons in their new order. Scoped
// to the collection so a stray id can't reorder another collection's lessons.
app.put('/:id/lessons/reorder', async (c) => {
  const userId = getCurrentUserId(c);
  const collectionId = c.req.param('id');
  const body = await c.req.json();
  const ids = body.ids;

  if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== 'string')) {
    return c.json({ error: 'ids must be an array of strings' }, 400);
  }

  const update = db.prepare('UPDATE lessons SET sortOrder = ? WHERE id = ? AND collectionId = ? AND userId = ?');
  db.transaction((orderedIds: string[]) => {
    orderedIds.forEach((lessonId, index) => update.run(index, lessonId, collectionId, userId));
  })(ids);

  return c.json({ success: true });
});

export default app;
