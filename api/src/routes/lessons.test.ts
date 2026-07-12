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

describe('lessons route', () => {
  beforeEach(reset);
  afterEach(reset);

  test('DELETE /:id retains vocabulary and clears its source lesson', async () => {
    db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
       VALUES ('collection-1', 'Collection', 'Unknown', 'af', ?, ?, 'local')`,
    ).run(TS, TS);
    db.prepare(
      `INSERT INTO lessons
        (id, collectionId, title, textContent, language, createdAt, lastReadAt, userId)
       VALUES ('lesson-1', 'collection-1', 'Lesson', '', 'af', ?, ?, 'local')`,
    ).run(TS, TS);
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
});
