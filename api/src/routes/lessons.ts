import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, LessonRow } from '../db';
import { countWords } from '../lib/html-to-markdown';
import { normalizeText } from '../lib/languages';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { entitlements, planLimitResponse } from '../lib/entitlements';
import { aggregateGrowthCheck, growingRowCheck, lessonTextBytes } from '../lib/storage-limits';
import {
  validateFiniteNumber,
  validateOwnedReference,
  validateSafeInteger,
} from '../lib/persisted-input';

const app = new Hono();

// GET /api/lessons/:id
// By-id routes scope to the active language (defense-in-depth): a stale
// cross-language id 404s rather than reading/mutating another language's lesson.
app.get('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
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
  const collectionIdError = validateOwnedReference(
    'collections',
    body.collectionId,
    userId,
    'collectionId',
    { nullable: false },
  );
  if (collectionIdError) return c.json({ error: collectionIdError }, 400);
  if (body.title !== undefined && typeof body.title !== 'string') {
    return c.json({ error: 'title must be a string' }, 400);
  }
  if (body.textContent !== undefined && typeof body.textContent !== 'string') {
    return c.json({ error: 'textContent must be a string' }, 400);
  }
  const sortOrderError = validateSafeInteger(body.sortOrder, 'sortOrder', { min: 0 });
  if (sortOrderError) return c.json({ error: sortOrderError }, 400);
  const language = resolveLanguage(c.req.query('language'), userId);
  const existing = db
    .prepare('SELECT title, textContent FROM lessons WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, language) as { title: string; textContent: string } | undefined;

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];

  // Text ingress (#289): lesson edits get NFC'd like every other import path.
  if (body.title !== undefined) {
    updates.push('title = ?');
    values.push(normalizeText(body.title));
  }
  if (body.textContent !== undefined) {
    const textContent = normalizeText(body.textContent);
    updates.push('textContent = ?');
    values.push(textContent);
    updates.push('wordCount = ?');
    values.push(countWords(textContent));
  }
  if (body.sortOrder !== undefined) {
    updates.push('sortOrder = ?');
    values.push(body.sortOrder);
  }
  if (body.collectionId !== undefined) {
    updates.push('collectionId = ?');
    values.push(body.collectionId);
  }

  updates.push('lastReadAt = ?');
  values.push(new Date().toISOString());
  values.push(id);
  values.push(userId);
  values.push(language);

  let checks = [] as Array<{
    metric: 'maxLessonTextBytes' | 'maxLessonTextBytesTotal';
    requested: number;
  }>;
  if (existing && (body.title !== undefined || body.textContent !== undefined)) {
    const nextTitle = body.title !== undefined ? normalizeText(body.title) : existing.title;
    const nextText =
      body.textContent !== undefined ? normalizeText(body.textContent) : existing.textContent;
    const previousBytes = lessonTextBytes(existing.textContent, existing.title);
    const nextBytes = lessonTextBytes(nextText, nextTitle);
    checks = [
      ...growingRowCheck('maxLessonTextBytes', nextBytes, previousBytes),
      ...aggregateGrowthCheck('maxLessonTextBytesTotal', nextBytes, previousBytes),
    ] as typeof checks;
  }

  const verdict = entitlements.reserveCount(userId, checks, () => {
    db.prepare(
      `UPDATE lessons SET ${updates.join(', ')} WHERE id = ? AND userId = ? AND language = ?`,
    ).run(...values);
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ success: true });
});

// DELETE /api/lessons/:id
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  db.transaction(() => {
    const owned = db
      .prepare('SELECT 1 FROM lessons WHERE id = ? AND userId = ? AND language = ?')
      .get(id, userId, lang);
    if (!owned) return;

    // Vocabulary is portable after its source lesson is removed.
    db.prepare('UPDATE vocab SET bookId = NULL WHERE bookId = ? AND userId = ?').run(id, userId);
    db.prepare('DELETE FROM lessons WHERE id = ? AND userId = ? AND language = ?').run(
      id,
      userId,
      lang,
    );
  })();
  return c.json({ success: true });
});

// PUT /api/lessons/:id/progress
app.put('/:id/progress', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const body = await c.req.json();
  const now = new Date().toISOString();

  const scrollError = validateSafeInteger(body.scrollPosition, 'scrollPosition', { min: 0 });
  if (scrollError) return c.json({ error: scrollError }, 400);
  const percentError = validateFiniteNumber(body.percentComplete, 'percentComplete', {
    min: 0,
    max: 100,
  });
  if (percentError) return c.json({ error: percentError }, 400);

  const existing = db
    .prepare('SELECT id, collectionId FROM lessons WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as { id: string; collectionId: string | null } | undefined;
  if (!existing) {
    return c.json({ error: 'Lesson not found' }, 404);
  }

  db.prepare(
    `
    UPDATE lessons SET
      progress_scrollPosition = ?,
      progress_percentComplete = ?,
      lastReadAt = ?
    WHERE id = ? AND userId = ? AND language = ?
  `,
  ).run(body.scrollPosition ?? 0, body.percentComplete ?? 0, now, id, userId, lang);

  if (existing.collectionId) {
    db.prepare('UPDATE collections SET lastReadAt = ? WHERE id = ? AND userId = ?').run(
      now,
      existing.collectionId,
      userId,
    );
  }

  return c.json({ success: true });
});

export default app;
