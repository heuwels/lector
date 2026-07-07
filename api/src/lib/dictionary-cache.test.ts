import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import { cacheAcceptedEntry } from './dictionary-db';

function reset() {
  db.prepare('DELETE FROM cached_senses').run();
  db.prepare('DELETE FROM cached_related_forms').run();
  db.prepare('DELETE FROM cached_entries').run();
}

describe('cached_entries — compound (word, language) key', () => {
  beforeEach(reset);
  afterEach(reset);

  test('the same word caches independently per language', () => {
    cacheAcceptedEntry({ word: 'die', language: 'af', senses: [{ partOfSpeech: 'article', gloss: 'the' }] });
    cacheAcceptedEntry({ word: 'die', language: 'de', senses: [{ partOfSpeech: 'article', gloss: 'the (feminine)' }] });

    // Both rows coexist — the old word-only PK would have collapsed them to one.
    const langs = db
      .prepare("SELECT language FROM cached_entries WHERE word = 'die' ORDER BY language")
      .all() as { language: string }[];
    expect(langs.map((r) => r.language)).toEqual(['af', 'de']);

    const afGloss = db
      .prepare("SELECT gloss FROM cached_senses WHERE word = 'die' AND language = 'af'")
      .all() as { gloss: string }[];
    const deGloss = db
      .prepare("SELECT gloss FROM cached_senses WHERE word = 'die' AND language = 'de'")
      .all() as { gloss: string }[];
    expect(afGloss.map((s) => s.gloss)).toEqual(['the']);
    expect(deGloss.map((s) => s.gloss)).toEqual(['the (feminine)']);
  });

  test('re-caching a word in one language leaves the other language untouched', () => {
    cacheAcceptedEntry({ word: 'die', language: 'af', senses: [{ partOfSpeech: 'article', gloss: 'the' }] });
    cacheAcceptedEntry({ word: 'die', language: 'de', senses: [{ partOfSpeech: 'article', gloss: 'the (feminine)' }] });

    // Overwrite the 'af' entry; 'de' must be undisturbed.
    cacheAcceptedEntry({ word: 'die', language: 'af', senses: [{ partOfSpeech: 'verb', gloss: 'to die (loanword)' }] });

    const af = db
      .prepare("SELECT gloss FROM cached_senses WHERE word = 'die' AND language = 'af'")
      .all() as { gloss: string }[];
    const de = db
      .prepare("SELECT gloss FROM cached_senses WHERE word = 'die' AND language = 'de'")
      .all() as { gloss: string }[];
    expect(af.map((s) => s.gloss)).toEqual(['to die (loanword)']); // replaced, not appended
    expect(de.map((s) => s.gloss)).toEqual(['the (feminine)']); // untouched
    expect((db.prepare("SELECT COUNT(*) AS n FROM cached_entries WHERE word = 'die'").get() as { n: number }).n).toBe(2);
  });
});
