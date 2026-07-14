import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
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
