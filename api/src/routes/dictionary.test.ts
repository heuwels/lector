import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import { makeDictionaryRoutes } from './dictionary';

const app = makeDictionaryRoutes((c) => c?.req.header('x-test-user') || 'alice');

function request(userId: string, path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-test-user': userId },
  });
}

function reset() {
  db.prepare('DELETE FROM cached_senses').run();
  db.prepare('DELETE FROM cached_related_forms').run();
  db.prepare('DELETE FROM cached_entries').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
  db.prepare("DELETE FROM dailyStats WHERE userId IN ('alice', 'bob', 'charlie')").run();
}

describe('dictionary accepted cache routes', () => {
  beforeEach(reset);
  afterEach(reset);

  test('owners see only their accepted sense for the same word and language', async () => {
    for (const [userId, gloss] of [
      ['alice', 'Alice meaning'],
      ['bob', 'Bob meaning'],
    ] as const) {
      const response = await request(userId, '/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: 'zzrouteword',
          language: 'af',
          senses: [{ partOfSpeech: 'noun', gloss }],
          sourceSentence: `${userId} private sentence`,
        }),
      });
      expect(response.status).toBe(200);
    }

    const alice = await (await request('alice', '/lookup?word=zzrouteword&language=af')).json();
    const bob = await (await request('bob', '/lookup?word=zzrouteword&language=af')).json();
    const stranger = await (
      await request('charlie', '/lookup?word=zzrouteword&language=af')
    ).json();
    expect(alice.entry.senses[0].gloss).toBe('Alice meaning');
    expect(bob.entry.senses[0].gloss).toBe('Bob meaning');
    expect(stranger.entry).toBeNull();
  });

  test('omitted language resolves from the owner setting', async () => {
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      'alice',
      'targetLanguage',
      '"de"',
    );
    const response = await request('alice', '/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'zzdeutsch',
        senses: [{ partOfSpeech: 'noun', gloss: 'German sense' }],
      }),
    });
    expect(response.status).toBe(200);
    expect(
      db
        .prepare('SELECT language FROM cached_entries WHERE userId = ? AND word = ?')
        .get('alice', 'zzdeutsch'),
    ).toEqual({ language: 'de' });
  });

  test('rejects malformed nested content before writing', async () => {
    const response = await request('alice', '/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'zzinvalid',
        language: 'af',
        senses: [{ partOfSpeech: 'noun', gloss: 'x'.repeat(513) }],
      }),
    });
    expect(response.status).toBe(400);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM cached_entries WHERE userId = ?').get('alice'),
    ).toEqual({ n: 0 });
  });

  test('rejects an oversized body before JSON parsing or writing', async () => {
    const response = await request('alice', '/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignored: 'x'.repeat(300 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM cached_entries WHERE userId = ?').get('alice'),
    ).toEqual({ n: 0 });
  });

  test('rejects a missing lookup word and returns a clean miss without recording study', async () => {
    const missing = await request('alice', '/lookup?language=af');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'Word is required' });

    const miss = await request('alice', '/lookup?word=zzmissing&language=af');
    expect(miss.status).toBe(200);
    expect(await miss.json()).toEqual({ entry: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM dailyStats WHERE userId = 'alice'").get()).toEqual(
      { n: 0 },
    );
  });

  test('a cache hit records the lookup on the resolved language row', async () => {
    const cached = await request('alice', '/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'zzstudied',
        language: 'af',
        senses: [{ partOfSpeech: 'noun', gloss: 'studied meaning' }],
      }),
    });
    expect(cached.status).toBe(200);

    const lookup = await request('alice', '/lookup?word=zzstudied&language=af');

    expect(lookup.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT language, dictionaryLookups FROM dailyStats WHERE userId = 'alice' ORDER BY date DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ language: 'af', dictionaryLookups: 1 });
  });

  test('rejects malformed JSON before any cache write', async () => {
    const response = await request('alice', '/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Malformed JSON body' });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM cached_entries WHERE userId = 'alice'").get(),
    ).toEqual({ n: 0 });
  });
});
