import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/stats');

function reset() {
  db.prepare('DELETE FROM dailyStats').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

function setLang(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function addActiveDay(date: string, language: string, lookups = 5) {
  db.prepare('INSERT INTO dailyStats (date, language, dictionaryLookups) VALUES (?, ?, ?)').run(
    date,
    language,
    lookups,
  );
}

describe('stats /streak', () => {
  beforeEach(reset);
  afterEach(reset);

  test('is app-wide: a day studied only in another language still counts toward the streak', async () => {
    // Three consecutive active days; the middle one was studied only in `de`.
    addActiveDay('2026-01-01', 'af');
    addActiveDay('2026-01-02', 'de');
    addActiveDay('2026-01-03', 'af');
    setLang('af');

    const res = await app.request('/streak?language=af');
    expect(res.status).toBe(200);
    const { longest } = (await res.json()) as { longest: number };

    // App-wide → all three days are active → the longest run is 3. The previous
    // (buggy) per-language `WHERE language = 'af'` filter would drop 2026-01-02
    // and report 1, silently breaking multi-language streaks. Guards the
    // CLAUDE.md "One streak definition app-wide" invariant.
    expect(longest).toBe(3);
  });
});
