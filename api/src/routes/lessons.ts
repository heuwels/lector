import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, LessonRow, TranscriptSegmentRow } from '../db';
import { countWords } from '../lib/html-to-markdown';
import { normalizeText } from '../lib/languages';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { audioContentType, deleteAudioFile } from '../lib/audio-files';
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

// GET /api/lessons/:id/segments (#185)
// The audio-timestamped transcript segments for listen-along, in playback
// order. Empty array until transcription is done (or for text lessons).
app.get('/:id/segments', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const owned = db
    .prepare('SELECT 1 FROM lessons WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang);
  if (!owned) {
    return c.json({ error: 'Lesson not found' }, 404);
  }
  const segments = db
    .prepare(
      'SELECT idx, startMs, endMs, text FROM transcript_segments WHERE userId = ? AND lessonId = ? ORDER BY idx ASC',
    )
    .all(userId, id) as Pick<TranscriptSegmentRow, 'idx' | 'startMs' | 'endMs' | 'text'>[];
  return c.json(segments);
});

// GET /api/lessons/:id/audio (#185)
// Range-seekable audio serving for the listen-along player. Seeking a long
// podcast in <audio> requires honoring `Range` with 206 + Content-Range —
// browsers refuse to scrub otherwise. The browser talks to Hono directly
// (the Next proxy was removed in #188), so nothing strips these headers.
app.get('/:id/audio', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const lesson = db
    .prepare('SELECT audioPath FROM lessons WHERE id = ? AND userId = ? AND language = ?')
    .get(id, userId, lang) as { audioPath: string | null } | undefined;
  if (!lesson?.audioPath) {
    return c.json({ error: 'Lesson has no audio' }, 404);
  }
  const file = Bun.file(lesson.audioPath);
  if (!(await file.exists())) {
    return c.json({ error: 'Audio file is missing' }, 404);
  }
  const size = file.size;
  const contentType = audioContentType(lesson.audioPath);

  const range = c.req.header('range');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] !== '' || match[2] !== '')) {
    // Suffix form (bytes=-N) means "the last N bytes".
    const start =
      match[1] === '' ? Math.max(0, size - parseInt(match[2], 10)) : parseInt(match[1], 10);
    let end = match[1] !== '' && match[2] !== '' ? parseInt(match[2], 10) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  return new Response(file, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    },
  });
});

// POST /api/lessons/:id/retry-transcription (#185)
// Re-queue a failed transcription (error → pending, counter reset) so the
// import UI's Retry button works after fixing the ASR server / config.
app.post('/:id/retry-transcription', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const lang = resolveLanguage(c.req.query('language'), userId);
  const changed = db
    .prepare(
      `UPDATE lessons
          SET transcriptionStatus = 'pending', transcriptionError = NULL, transcriptionAttempts = 0
        WHERE id = ? AND userId = ? AND language = ? AND transcriptionStatus = 'error'`,
    )
    .run(id, userId, lang).changes;
  if (changed === 0) {
    return c.json({ error: 'Lesson has no failed transcription to retry' }, 404);
  }
  return c.json({ success: true });
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
  let audioPath: string | null = null;
  db.transaction(() => {
    const owned = db
      .prepare('SELECT audioPath FROM lessons WHERE id = ? AND userId = ? AND language = ?')
      .get(id, userId, lang) as { audioPath: string | null } | undefined;
    if (!owned) return;
    audioPath = owned.audioPath;

    // Vocabulary is portable after its source lesson is removed.
    db.prepare('UPDATE vocab SET bookId = NULL WHERE bookId = ? AND userId = ?').run(id, userId);
    // FK enforcement is off app-wide, so cascade the segments manually.
    db.prepare('DELETE FROM transcript_segments WHERE userId = ? AND lessonId = ?').run(userId, id);
    db.prepare('DELETE FROM lessons WHERE id = ? AND userId = ? AND language = ?').run(
      id,
      userId,
      lang,
    );
  })();
  // The audio file is outside the transaction by nature; unlink after the row
  // is gone so a failed delete never orphans a lesson that points at nothing.
  deleteAudioFile(audioPath);
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
