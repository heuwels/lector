import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { AUDIO_DIR, db } from '../db';
import app from './lessons';

const TS = '2026-01-01T00:00:00Z';

function reset() {
  db.prepare('DELETE FROM vocab').run();
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
}

function seedLesson() {
  db.prepare(
    `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
     VALUES ('collection-1', 'Collection', 'Unknown', 'af', ?, ?, 'local')`,
  ).run(TS, TS);
  db.prepare(
    `INSERT INTO lessons
      (id, collectionId, title, textContent, language, createdAt, lastReadAt, userId)
     VALUES ('lesson-1', 'collection-1', 'Lesson', '', 'af', ?, ?, 'local')`,
  ).run(TS, TS);
}

describe('lessons route', () => {
  beforeEach(reset);
  afterEach(reset);

  test('DELETE /:id retains vocabulary and clears its source lesson', async () => {
    seedLesson();
    db.prepare(
      `INSERT INTO vocab
        (id, text, type, sentence, translation, state, stateUpdatedAt, bookId, language, createdAt, userId)
       VALUES ('word-1', 'huis', 'word', '', '', 'new', ?, 'lesson-1', 'af', ?, 'local')`,
    ).run(TS, TS);

    const response = await app.request('/lesson-1?language=af', { method: 'DELETE' });

    expect(response.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE id = 'lesson-1'").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT bookId FROM vocab WHERE id = 'word-1'").get()).toEqual({
      bookId: null,
    });
  });

  test('PUT /:id normalizes text and recomputes word count', async () => {
    seedLesson();

    const response = await app.request('/lesson-1?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collectionId: 'collection-1',
        title: 'Cafe\u0301',
        textContent: 'Een twee drie.',
        sortOrder: 2,
      }),
    });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT title, textContent, wordCount, sortOrder FROM lessons WHERE id = 'lesson-1'",
        )
        .get(),
    ).toEqual({
      title: 'Café',
      textContent: 'Een twee drie.',
      wordCount: 3,
      sortOrder: 2,
    });
  });

  test('PUT /:id rejects a collection owned by another tenant without mutating the lesson', async () => {
    seedLesson();
    db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
       VALUES ('foreign-collection', 'Private', 'Other', 'af', ?, ?, 'lessons-intruder')`,
    ).run(TS, TS);

    const response = await app.request('/lesson-1?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionId: 'foreign-collection', title: 'Changed' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'collectionId must reference one of your collections',
    });
    expect(db.prepare("SELECT title FROM lessons WHERE id = 'lesson-1'").get()).toEqual({
      title: 'Lesson',
    });
  });

  test('PUT /:id/progress validates bounds, updates the lesson, and touches its collection', async () => {
    seedLesson();

    const invalid = await app.request('/lesson-1/progress?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrollPosition: -1, percentComplete: 101 }),
    });
    expect(invalid.status).toBe(400);

    const response = await app.request('/lesson-1/progress?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrollPosition: 450, percentComplete: 62.5 }),
    });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT progress_scrollPosition, progress_percentComplete FROM lessons WHERE id = 'lesson-1'",
        )
        .get(),
    ).toEqual({ progress_scrollPosition: 450, progress_percentComplete: 62.5 });
    expect(
      (
        db.prepare("SELECT lastReadAt FROM collections WHERE id = 'collection-1'").get() as {
          lastReadAt: string;
        }
      ).lastReadAt,
    ).not.toBe(TS);

    const missing = await app.request('/missing/progress?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrollPosition: 0, percentComplete: 0 }),
    });
    expect(missing.status).toBe(404);
  });
});

describe('audio lesson routes (#185)', () => {
  beforeEach(() => {
    reset();
    db.prepare('DELETE FROM transcript_segments').run();
  });
  afterEach(() => {
    reset();
    db.prepare('DELETE FROM transcript_segments').run();
  });

  async function seedAudioLesson(status = 'done'): Promise<string> {
    const audioPath = `${AUDIO_DIR}/lesson-1.mp3`;
    await Bun.write(
      audioPath,
      new Uint8Array(100).map((_, i) => i),
    );
    seedLesson();
    db.prepare(
      `UPDATE lessons SET audioPath = ?, audioDurationMs = 14000, transcriptionStatus = ? WHERE id = 'lesson-1'`,
    ).run(audioPath, status);
    db.prepare(
      `INSERT INTO transcript_segments (userId, lessonId, idx, startMs, endMs, text)
       VALUES ('local', 'lesson-1', 0, 0, 2000, 'Goeie môre.'),
              ('local', 'lesson-1', 1, 2000, 4000, 'Welkom terug.')`,
    ).run();
    return audioPath;
  }

  test('GET /:id/segments returns ordered segments; 404 for unknown lesson', async () => {
    await seedAudioLesson();

    const response = await app.request('/lesson-1/segments?language=af');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { idx: 0, startMs: 0, endMs: 2000, text: 'Goeie môre.' },
      { idx: 1, startMs: 2000, endMs: 4000, text: 'Welkom terug.' },
    ]);

    const missing = await app.request('/missing/segments?language=af');
    expect(missing.status).toBe(404);
  });

  test('GET /:id/audio serves the full file with Accept-Ranges', async () => {
    await seedAudioLesson();

    const response = await app.request('/lesson-1/audio?language=af');
    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  test('GET /:id/audio honours Range with 206 + Content-Range (seek survives)', async () => {
    await seedAudioLesson();

    const response = await app.request('/lesson-1/audio?language=af', {
      headers: { Range: 'bytes=10-19' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 10-19/100');
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(10);
    expect(body[0]).toBe(10);

    // Suffix form: the last N bytes.
    const suffix = await app.request('/lesson-1/audio?language=af', {
      headers: { Range: 'bytes=-5' },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('Content-Range')).toBe('bytes 95-99/100');

    const unsatisfiable = await app.request('/lesson-1/audio?language=af', {
      headers: { Range: 'bytes=200-300' },
    });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get('Content-Range')).toBe('bytes */100');
  });

  test('GET /:id/audio 404s for a text lesson', async () => {
    seedLesson();
    const response = await app.request('/lesson-1/audio?language=af');
    expect(response.status).toBe(404);
  });

  test('POST /:id/retry-transcription re-queues only failed lessons', async () => {
    await seedAudioLesson('error');
    db.prepare(
      "UPDATE lessons SET transcriptionError = 'boom', transcriptionAttempts = 3 WHERE id = 'lesson-1'",
    ).run();

    const response = await app.request('/lesson-1/retry-transcription?language=af', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT transcriptionStatus, transcriptionError, transcriptionAttempts FROM lessons WHERE id = 'lesson-1'",
        )
        .get(),
    ).toEqual({
      transcriptionStatus: 'pending',
      transcriptionError: null,
      transcriptionAttempts: 0,
    });

    // Not retryable once it's no longer in error state.
    const again = await app.request('/lesson-1/retry-transcription?language=af', {
      method: 'POST',
    });
    expect(again.status).toBe(404);
  });

  test('DELETE /:id removes segments and unlinks the audio file', async () => {
    const audioPath = await seedAudioLesson();
    expect(fs.existsSync(audioPath)).toBe(true);

    const response = await app.request('/lesson-1?language=af', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM transcript_segments WHERE lessonId = 'lesson-1'").get(),
    ).toEqual({ n: 0 });
    expect(fs.existsSync(audioPath)).toBe(false);
  });
});
