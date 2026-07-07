import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/data');

const TABLES = [
  'collections',
  'collection_groups',
  'lessons',
  'vocab',
  'knownWords',
  'clozeSentences',
  'dailyStats',
];

function reset() {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
}

function importData(payload: unknown) {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

const TS = '2026-01-01T00:00:00Z';

describe('data import/restore — language partitioning', () => {
  beforeEach(reset);
  afterEach(reset);

  test('restores language + previously-dropped columns; no cross-language row collapse', async () => {
    const res = await importData({
      collectionGroups: [{ id: 'g1', name: 'Group', sortOrder: 3, createdAt: TS }],
      collections: [
        { id: 'c_af', title: 'AF', language: 'af', groupId: 'g1', sortOrder: 2, createdAt: TS, lastReadAt: TS },
        { id: 'c_de', title: 'DE', language: 'de', groupId: null, sortOrder: 1, createdAt: TS, lastReadAt: TS },
      ],
      // Same word in two languages must NOT collapse (compound PK word, language).
      knownWords: [
        { word: 'die', language: 'af', state: 'known' },
        { word: 'die', language: 'de', state: 'level2' },
      ],
      // Same date in two languages must NOT collapse; ankiReviews + sessionStartedAt
      // must survive (they were dropped by the old import column list).
      dailyStats: [
        { date: '2026-06-20', language: 'af', minutesRead: 10, ankiReviews: 5, sessionStartedAt: '2026-06-20T08:00:00Z' },
        { date: '2026-06-20', language: 'de', minutesRead: 3, ankiReviews: 2, sessionStartedAt: '2026-06-20T09:00:00Z' },
      ],
      // blacklisted is a value-bearing column that the old import dropped → reset to 0.
      clozeSentences: [
        { id: 'cs1', sentence: 'Ek lees.', clozeWord: 'lees', clozeIndex: 1, translation: 'I read.', source: 'tatoeba', collection: 'random', nextReview: TS, blacklisted: 1, language: 'de' },
      ],
    });
    expect(res.status).toBe(200);

    // Groups restored, so collections' groupId resolves.
    expect((db.prepare('SELECT COUNT(*) AS n FROM collection_groups').get() as { n: number }).n).toBe(1);

    // collections: language + groupId + sortOrder all preserved.
    const cAf = db.prepare("SELECT language, groupId, sortOrder FROM collections WHERE id = 'c_af'").get() as {
      language: string; groupId: string | null; sortOrder: number;
    };
    expect(cAf).toEqual({ language: 'af', groupId: 'g1', sortOrder: 2 });
    expect((db.prepare("SELECT language FROM collections WHERE id = 'c_de'").get() as { language: string }).language).toBe('de');

    // knownWords: both languages survive.
    const kw = db
      .prepare("SELECT language, state FROM knownWords WHERE word = 'die' ORDER BY language")
      .all() as { language: string; state: string }[];
    expect(kw).toEqual([{ language: 'af', state: 'known' }, { language: 'de', state: 'level2' }]);

    // dailyStats: both languages survive; ankiReviews + sessionStartedAt preserved.
    const ds = db
      .prepare("SELECT language, minutesRead, ankiReviews, sessionStartedAt FROM dailyStats WHERE date = '2026-06-20' ORDER BY language")
      .all() as { language: string; minutesRead: number; ankiReviews: number; sessionStartedAt: string }[];
    expect(ds).toEqual([
      { language: 'af', minutesRead: 10, ankiReviews: 5, sessionStartedAt: '2026-06-20T08:00:00Z' },
      { language: 'de', minutesRead: 3, ankiReviews: 2, sessionStartedAt: '2026-06-20T09:00:00Z' },
    ]);

    // clozeSentences: language + blacklisted both preserved (blacklisted was reset before).
    const cs = db
      .prepare("SELECT language, blacklisted FROM clozeSentences WHERE id = 'cs1'")
      .get() as { language: string; blacklisted: number };
    expect(cs).toEqual({ language: 'de', blacklisted: 1 });
  });

  test('legacy backups with no language field restore as Afrikaans', async () => {
    await importData({
      knownWords: [{ word: 'hond', state: 'known' }], // pre-multi-language shape
      dailyStats: [{ date: '2026-05-01', minutesRead: 4 }],
    });
    expect((db.prepare("SELECT language FROM knownWords WHERE word = 'hond'").get() as { language: string }).language).toBe('af');
    expect((db.prepare("SELECT language FROM dailyStats WHERE date = '2026-05-01'").get() as { language: string }).language).toBe('af');
  });

  test('export includes language and collection_groups', async () => {
    db.prepare("INSERT INTO knownWords (word, language, state) VALUES ('kat', 'de', 'known')").run();
    db.prepare("INSERT INTO collection_groups (id, name, sortOrder, createdAt) VALUES ('g9', 'G', 0, ?)").run(TS);

    const res = await app.request('/');
    const data = (await res.json()) as { knownWords: { word: string; language: string }[]; collectionGroups: { id: string }[] };
    expect(data.knownWords.find((w) => w.word === 'kat')?.language).toBe('de');
    expect(data.collectionGroups.map((g) => g.id)).toContain('g9');
  });
});

describe('export/restore — credential redaction (#233)', () => {
  const clearKeys = () => db.prepare("DELETE FROM settings WHERE key IN ('anthropicApiKey', 'timezone')").run();
  beforeEach(clearKeys);
  afterEach(clearKeys);

  test('export replaces sensitive settings values with the sentinel', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'anthropicApiKey', ?)").run(
      JSON.stringify('sk-ant-live-secret')
    );
    db.prepare("INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'timezone', ?)").run(
      JSON.stringify('Australia/Sydney')
    );

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The raw value must not appear anywhere in the export payload.
    expect(raw).not.toContain('sk-ant-live-secret');

    const data = JSON.parse(raw) as { settings: { key: string; value: string }[] };
    expect(data.settings.find((s) => s.key === 'anthropicApiKey')?.value).toBe('__REDACTED__');
    // Non-sensitive settings still round-trip verbatim.
    expect(data.settings.find((s) => s.key === 'timezone')?.value).toBe(JSON.stringify('Australia/Sydney'));
  });

  test('restore skips the sentinel instead of clobbering a real stored key', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'anthropicApiKey', ?)").run(
      JSON.stringify('sk-ant-real')
    );

    const res = await importData({
      settings: [
        { key: 'anthropicApiKey', value: '__REDACTED__' },
        { key: 'timezone', value: JSON.stringify('Europe/Berlin') },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: { settings: number } };
    // The sentinel row is skipped; only the real setting counts as imported.
    expect(body.imported.settings).toBe(1);

    const key = db
      .prepare("SELECT value FROM settings WHERE userId = 'local' AND key = 'anthropicApiKey'")
      .get() as { value: string };
    expect(key.value).toBe(JSON.stringify('sk-ant-real'));
    const tz = db.prepare("SELECT value FROM settings WHERE userId = 'local' AND key = 'timezone'").get() as {
      value: string;
    };
    expect(tz.value).toBe(JSON.stringify('Europe/Berlin'));
  });
});
