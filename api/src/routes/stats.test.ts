import '../test-guard';
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

function addKnown(word: string, state: string, domain: string | null, language = 'af') {
  db.prepare('INSERT INTO knownWords (word, language, state, domain) VALUES (?, ?, ?, ?)').run(
    word,
    language,
    state,
    domain,
  );
}

function resetFluency() {
  db.prepare('DELETE FROM knownWords').run();
  db.prepare('DELETE FROM dailyStats').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

interface FluencyResp {
  totalKnownWords: number;
  byDomain: { domain: string; knownCount: number }[];
  pending: number;
}

describe('stats /fluency — byDomain + pending', () => {
  beforeEach(resetFluency);
  afterEach(resetFluency);

  // The radar maths is unit-tested in lib/domains.test.ts; this guards the
  // wiring: the handler aggregates from knownWords, scoped to the active
  // language, and folds the result through deriveDomainFluency.
  test('aggregates per-domain from knownWords, scoped to the active language, excluding general', async () => {
    addKnown('koffie', 'known', 'food');
    addKnown('tee', 'known', 'food');
    addKnown('dokter', 'level2', 'health');
    addKnown('die', 'known', 'general'); // classified, but never a radar axis
    addKnown('onbekend', 'known', null); // pending — mastery state, not yet classified
    addKnown('splinternuut', 'new', null); // NOT pending — the worker skips new/ignored
    addKnown('apple', 'known', 'food', 'nl'); // another language — must be excluded
    setLang('af');

    const res = await app.request('/fluency?language=af');
    expect(res.status).toBe(200);
    const body = (await res.json()) as FluencyResp;

    expect(body.byDomain).toHaveLength(10); // fixed taxonomy → stable axes
    expect(body.byDomain.some((d) => d.domain === 'general')).toBe(false);

    const food = body.byDomain.find((d) => d.domain === 'food');
    expect(food?.knownCount).toBe(2); // 2 af food words; the nl 'apple' is excluded

    expect(body.pending).toBe(1); // 'onbekend' only ('new' is excluded)
    // af-scoped known words: koffie, tee, die, onbekend = 4 (nl 'apple' excluded)
    expect(body.totalKnownWords).toBe(4);
  });
});

describe('GET /api/stats/activity — app-wide heatmap series (#238)', () => {
  beforeEach(reset);
  afterEach(reset);

  test('sums per date across languages so the heatmap agrees with the streak', async () => {
    setLang('af');
    // Same day, two languages: af has lookups, de has cloze practice.
    db.prepare(
      'INSERT INTO dailyStats (date, language, dictionaryLookups, clozePracticed) VALUES (?, ?, ?, ?)',
    ).run('2026-06-01', 'af', 3, 0);
    db.prepare(
      'INSERT INTO dailyStats (date, language, dictionaryLookups, clozePracticed) VALUES (?, ?, ?, ?)',
    ).run('2026-06-01', 'de', 0, 7);
    // A de-only day — the language-scoped af series would render this empty.
    db.prepare(
      'INSERT INTO dailyStats (date, language, minutesRead) VALUES (?, ?, ?)',
    ).run('2026-06-02', 'de', 12);

    const res = await app.request('/activity');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      date: string; dictionaryLookups: number; clozePracticed: number; minutesRead: number;
    }[];

    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ date: '2026-06-01', dictionaryLookups: 3, clozePracticed: 7 });
    // The de-only day is present regardless of the active language.
    expect(rows[1]).toMatchObject({ date: '2026-06-02', minutesRead: 12 });
  });
});
