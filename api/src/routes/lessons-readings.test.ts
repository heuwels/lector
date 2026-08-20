import '../test-guard';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { db } from '../db';

// GET /api/lessons/:id/readings, the reader's annotation layer (#289 4.4).
//
// The dictionary is mocked, so what is under test is the ROUTE's own job:
// turning a lesson's stored text into the exact word list to ask about. The
// dictionary query itself is covered against a real fixture DB in
// src/lib/dictionary-db.readings.test.ts.

const asked: string[][] = [];

mock.module('../lib/dictionary-db', () => ({
  lookupReadings: (words: readonly string[]) => {
    asked.push([...words]);
    // A reading per word, so the response shape is exercised too.
    return new Map(words.map((word) => [word, `<${word}>`]));
  },
}));

const { default: app } = await import('./lessons');

const TS = '2026-01-01T00:00:00Z';

function reset() {
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
  asked.length = 0;
}

/** A Chinese lesson. zh is the only pack that declares an annotation source. */
function seedLesson(textContent: string, segmentWords: string | null = null) {
  db.prepare(
    `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
     VALUES ('collection-zh', '合集', 'Unknown', 'zh', ?, ?, 'local')`,
  ).run(TS, TS);
  db.prepare(
    `INSERT INTO lessons
      (id, collectionId, title, textContent, segmentWords, language, createdAt, lastReadAt, userId)
     VALUES ('lesson-zh', 'collection-zh', '第一课', ?, ?, 'zh', ?, ?, 'local')`,
  ).run(textContent, segmentWords, TS, TS);
}

describe('GET /:id/readings word list', () => {
  beforeEach(reset);
  afterEach(reset);

  test('asks about every word of the lesson, and answers one reading each', async () => {
    seedLesson('我喜欢读书。');

    const response = await app.request('/lesson-zh/readings?language=zh');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      我: '<我>',
      喜欢: '<喜欢>',
      读书: '<读书>',
    });
  });

  // The stored segmentation is the whole point of #289 4.2: it is what the
  // reader draws its word spans from. If this route tokenized any other way,
  // the readings would be keyed to words no span ever carries and the reader
  // would print nothing.
  test('splits with the lesson stored segmentation', async () => {
    // A vocabulary that deliberately groups 喜欢读书 as ONE word, which the
    // default segmenter would never do.
    seedLesson('我喜欢读书。', JSON.stringify(['我', '喜欢读书']));

    await app.request('/lesson-zh/readings?language=zh');

    expect(asked).toEqual([['我', '喜欢读书']]);
  });

  // Punctuation and markdown syntax are not words, so they must never reach the
  // dictionary — the reader has nothing to attach their readings to.
  test('asks about words only', async () => {
    seedLesson('# 第一课\n\n我**喜欢**读书，你呢？');

    await app.request('/lesson-zh/readings?language=zh');

    expect(asked).toHaveLength(1);
    for (const word of asked[0]) {
      expect(word).not.toMatch(/[#*，。？\s]/u);
    }
    expect(asked[0]).toContain('喜欢');
  });

  test('asks nothing for an empty lesson', async () => {
    seedLesson('');

    const response = await app.request('/lesson-zh/readings?language=zh');

    expect(await response.json()).toEqual({});
  });
});
