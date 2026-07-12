import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import { cacheAcceptedEntry, lookupWord, validateCacheAcceptedInput } from './dictionary-db';

function reset() {
  db.prepare('DELETE FROM cached_senses').run();
  db.prepare('DELETE FROM cached_related_forms').run();
  db.prepare('DELETE FROM cached_entries').run();
}

describe('cached_entries — tenant, word, and language key', () => {
  beforeEach(reset);
  afterEach(reset);

  test('the same word caches independently per language', () => {
    cacheAcceptedEntry('alice', {
      word: 'die',
      language: 'af',
      senses: [{ partOfSpeech: 'article', gloss: 'the' }],
    });
    cacheAcceptedEntry('alice', {
      word: 'die',
      language: 'de',
      senses: [{ partOfSpeech: 'article', gloss: 'the (feminine)' }],
    });

    // Both rows coexist — the old word-only PK would have collapsed them to one.
    const langs = db
      .prepare(
        "SELECT language FROM cached_entries WHERE userId = 'alice' AND word = 'die' ORDER BY language",
      )
      .all() as { language: string }[];
    expect(langs.map((r) => r.language)).toEqual(['af', 'de']);

    const afGloss = db
      .prepare(
        "SELECT gloss FROM cached_senses WHERE userId = 'alice' AND word = 'die' AND language = 'af'",
      )
      .all() as { gloss: string }[];
    const deGloss = db
      .prepare(
        "SELECT gloss FROM cached_senses WHERE userId = 'alice' AND word = 'die' AND language = 'de'",
      )
      .all() as { gloss: string }[];
    expect(afGloss.map((s) => s.gloss)).toEqual(['the']);
    expect(deGloss.map((s) => s.gloss)).toEqual(['the (feminine)']);
  });

  test('re-caching a word in one language leaves the other language untouched', () => {
    cacheAcceptedEntry('alice', {
      word: 'die',
      language: 'af',
      senses: [{ partOfSpeech: 'article', gloss: 'the' }],
    });
    cacheAcceptedEntry('alice', {
      word: 'die',
      language: 'de',
      senses: [{ partOfSpeech: 'article', gloss: 'the (feminine)' }],
    });

    // Overwrite the 'af' entry; 'de' must be undisturbed.
    cacheAcceptedEntry('alice', {
      word: 'die',
      language: 'af',
      senses: [{ partOfSpeech: 'verb', gloss: 'to die (loanword)' }],
    });

    const af = db
      .prepare(
        "SELECT gloss FROM cached_senses WHERE userId = 'alice' AND word = 'die' AND language = 'af'",
      )
      .all() as { gloss: string }[];
    const de = db
      .prepare(
        "SELECT gloss FROM cached_senses WHERE userId = 'alice' AND word = 'die' AND language = 'de'",
      )
      .all() as { gloss: string }[];
    expect(af.map((s) => s.gloss)).toEqual(['to die (loanword)']); // replaced, not appended
    expect(de.map((s) => s.gloss)).toEqual(['the (feminine)']); // untouched
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM cached_entries WHERE userId = 'alice' AND word = 'die'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(2);
  });

  test('two users can cache the same word without reading or replacing each other', () => {
    const word = 'zztenantword';
    cacheAcceptedEntry('alice', {
      word,
      language: 'af',
      senses: [{ partOfSpeech: 'noun', gloss: 'Alice meaning' }],
      relatedForms: [{ form: 'alice-form', relation: 'related' }],
      sourceSentence: 'Alice private sentence',
    });
    cacheAcceptedEntry('bob', {
      word,
      language: 'af',
      senses: [{ partOfSpeech: 'verb', gloss: 'Bob meaning' }],
      relatedForms: [{ form: 'bob-form', relation: 'derived' }],
      sourceSentence: 'Bob private sentence',
    });

    expect(lookupWord('alice', word, 'af')?.senses[0]?.gloss).toBe('Alice meaning');
    expect(lookupWord('bob', word, 'af')?.senses[0]?.gloss).toBe('Bob meaning');
    expect(lookupWord('charlie', word, 'af')).toBeUndefined();

    cacheAcceptedEntry('alice', {
      word,
      language: 'af',
      senses: [{ partOfSpeech: 'noun', gloss: 'Alice replacement' }],
    });
    expect(lookupWord('alice', word, 'af')?.senses[0]?.gloss).toBe('Alice replacement');
    expect(lookupWord('bob', word, 'af')?.senses[0]?.gloss).toBe('Bob meaning');
    const bob = db
      .prepare(
        'SELECT sourceSentence FROM cached_entries WHERE userId = ? AND word = ? AND language = ?',
      )
      .get('bob', word, 'af') as { sourceSentence: string };
    expect(bob.sourceSentence).toBe('Bob private sentence');
  });

  test('validates nested cache bodies before writes', () => {
    expect(
      validateCacheAcceptedInput({
        word: 'test',
        language: 'af',
        senses: [{ partOfSpeech: 'noun', gloss: '' }],
      }).ok,
    ).toBe(false);
    expect(
      validateCacheAcceptedInput({
        word: 'test',
        language: 'af',
        senses: [{ partOfSpeech: 'noun', gloss: 'meaning' }],
        relatedForms: [{ form: 'x', relation: 42 }],
      }).ok,
    ).toBe(false);
  });
});
