import '../test-guard';
import { describe, expect, test } from 'bun:test';
import { getLanguageConfig } from '../lib/languages';
import { lessonReadingWords } from './lessons';

// The word list GET /api/lessons/:id/readings asks the dictionary about
// (#289 4.4). This is the route's own job, so it is tested as a pure function
// with no dictionary at all. The query itself is covered against a fixture DB
// in src/lib/dictionary-db.readings.test.ts.
//
// Deliberately NOT a route request with a mocked dictionary module:
// `mock.module` replaces the module for every later test file in the process,
// which silently stubbed the real lookups in that fixture suite.

const zh = getLanguageConfig('zh');

describe('lessonReadingWords', () => {
  test('splits an unspaced sentence into its words', () => {
    expect(lessonReadingWords({ textContent: '我喜欢读书。', segmentWords: null }, zh)).toEqual([
      '我',
      '喜欢',
      '读书',
    ]);
  });

  // The stored segmentation is the whole point of #289 4.2: it is what the
  // reader draws its word spans from. A word list built any other way is keyed
  // to spans that do not exist.
  test('prefers the lesson stored segmentation over the default engine', () => {
    // A vocabulary that groups 喜欢读书 as ONE word, which the default segmenter
    // would never do.
    expect(
      lessonReadingWords(
        { textContent: '我喜欢读书。', segmentWords: JSON.stringify(['我', '喜欢读书']) },
        zh,
      ),
    ).toEqual(['我', '喜欢读书']);
  });

  test('falls back to the default engine when the stored list is malformed', () => {
    expect(
      lessonReadingWords({ textContent: '我喜欢读书。', segmentWords: 'not json' }, zh),
    ).toEqual(['我', '喜欢', '读书']);
  });

  // Punctuation and markdown syntax are not words, so they must never reach the
  // dictionary — the reader has nothing to attach their readings to.
  test('returns words only', () => {
    const words = lessonReadingWords(
      { textContent: '# 第一课\n\n我**喜欢**读书，你呢？', segmentWords: null },
      zh,
    );

    expect(words).toContain('喜欢');
    for (const word of words) expect(word).not.toMatch(/[#*，。？\s]/u);
  });

  test('repeats a word the page repeats, and lets the lookup fold the duplicates', () => {
    expect(lessonReadingWords({ textContent: '书。书。', segmentWords: null }, zh)).toEqual([
      '书',
      '书',
    ]);
  });

  test('returns nothing for an empty lesson', () => {
    expect(lessonReadingWords({ textContent: '', segmentWords: null }, zh)).toEqual([]);
  });
});
