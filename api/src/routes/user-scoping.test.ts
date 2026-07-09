import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import AdmZip from 'adm-zip';
import path from 'path';
import { db } from '../db';

const { default: vocabApp } = await import('../routes/vocab');
const { default: clozeApp } = await import('../routes/cloze');
const { default: knownWordsApp } = await import('../routes/known-words');
const { default: settingsApp } = await import('../routes/settings');
const { default: collectionsApp } = await import('../routes/collections');
const { default: lessonsApp } = await import('../routes/lessons');
const { default: journalApp } = await import('../routes/journal');
const { default: statsApp } = await import('../routes/stats');
const { default: chatApp } = await import('../routes/chat');
const { default: groupsApp } = await import('../routes/groups');
const { default: dataApp } = await import('../routes/data');
const { default: importApp } = await import('../routes/import');
const { default: tokensApp } = await import('../routes/tokens');
const { default: starterApp } = await import('../routes/starter');

// The userId-scoping ratchet (#217, plan 010 piece 2) — the multi-tenant twin
// of language-scoping.test.ts. Rows are seeded for a different user directly
// in the DB; every route must behave as if they do not exist: lists exclude
// them, by-id reads 404, mutations no-op. When adding a user-data route, add
// its cross-user cases here.

const INTRUDER = 'intruder-user';
const TS = '2026-01-01T00:00:00Z';

// Every user-data table; shared read-only tables are deliberately absent.
const USER_TABLES = [
  'collections',
  'lessons',
  'vocab',
  'knownWords',
  'clozeSentences',
  'dailyStats',
  'chat_messages',
  'journal_entries',
  'collection_groups',
  'api_tokens',
  'settings',
];

function reset() {
  db.prepare('DELETE FROM vocab').run();
  db.prepare('DELETE FROM knownWords').run();
  db.prepare('DELETE FROM clozeSentences').run();
  db.prepare('DELETE FROM collections').run();
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collection_groups').run();
  db.prepare('DELETE FROM journal_entries').run();
  db.prepare('DELETE FROM chat_messages').run();
  db.prepare('DELETE FROM dailyStats').run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'ratchet_%'").run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'starterSeeded:%'").run();
  db.prepare('DELETE FROM api_tokens WHERE userId = ?').run(INTRUDER);
}

function seedIntruderCollection(id: string) {
  db.prepare(
    `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
     VALUES (?, 'Geheime Boek', 'Indringer', 'af', ?, ?, ?)`,
  ).run(id, TS, TS, INTRUDER);
}

function seedIntruderLesson(id: string, collectionId: string) {
  db.prepare(
    `INSERT INTO lessons (id, collectionId, title, textContent, wordCount, language, createdAt, lastReadAt, userId)
     VALUES (?, ?, 'Geheime Les', 'geheime teks', 2, 'af', ?, ?, ?)`,
  ).run(id, collectionId, TS, TS, INTRUDER);
}

function seedIntruderVocab(id: string) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
     VALUES (?, 'geheim', 'word', 'n sin', 'secret', 'new', ?, ?, 'af', ?)`,
  ).run(id, TS, TS, INTRUDER);
}

function seedIntruderCloze(id: string) {
  db.prepare(
    `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
     VALUES (?, 'Die ___ is geheim.', 'woord', 1, 'The word is secret.', 'tatoeba', 'random', ?, 'af', ?)`,
  ).run(id, TS, INTRUDER);
}

describe('userId scoping ratchet', () => {
  beforeEach(reset);
  afterEach(reset);

  test('every user-data table carries the userId column (migration ratchet)', () => {
    for (const table of USER_TABLES) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(cols.length, `${table} should exist`).toBeGreaterThan(0);
      expect(
        cols.some((c) => c.name === 'userId'),
        `${table} must carry userId`,
      ).toBe(true);
    }
  });

  test("vocab lists exclude another user's rows", async () => {
    seedIntruderVocab('v_intruder');
    const res = await vocabApp.request('/?language=af');
    const rows = (await res.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'v_intruder')).toBeUndefined();
  });

  test("vocab by-id routes 404 / no-op on another user's row", async () => {
    seedIntruderVocab('v_intruder');

    expect((await vocabApp.request('/v_intruder')).status).toBe(404);

    const put = await vocabApp.request('/v_intruder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ translation: 'hijacked' }),
    });
    expect(put.status).toBe(404);

    const del = await vocabApp.request('/v_intruder', { method: 'DELETE' });
    expect(del.status).toBe(404);
    const survives = db.prepare('SELECT COUNT(*) AS n FROM vocab WHERE id = ?').get('v_intruder') as { n: number };
    expect(survives.n).toBe(1);
  });

  test("known-words map excludes another user's words", async () => {
    db.prepare("INSERT INTO knownWords (userId, word, language, state) VALUES (?, 'geheim', 'af', 'known')").run(INTRUDER);
    const res = await knownWordsApp.request('/?language=af');
    const map = (await res.json()) as Record<string, string>;
    expect(map.geheim).toBeUndefined();
  });

  test("cloze routes never serve or mutate another user's cards", async () => {
    seedIntruderCloze('c_intruder');

    const list = await clozeApp.request('/?language=af');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'c_intruder')).toBeUndefined();

    const due = await clozeApp.request('/due?language=af');
    const dueRows = (await due.json()) as { id: string }[];
    expect(dueRows.find((r) => r.id === 'c_intruder')).toBeUndefined();

    expect((await clozeApp.request('/c_intruder?language=af')).status).toBe(404);

    const review = await clozeApp.request('/c_intruder/review?language=af', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct: true, masteryLevel: 25, nextReview: TS }),
    });
    expect(review.status).toBe(404);

    await clozeApp.request('/c_intruder?language=af', { method: 'DELETE' });
    const survives = db.prepare('SELECT COUNT(*) AS n FROM clozeSentences WHERE id = ?').get('c_intruder') as { n: number };
    expect(survives.n).toBe(1);
  });

  test("settings are per-user — reads exclude, writes land on the requester", async () => {
    db.prepare("INSERT INTO settings (userId, key, value) VALUES (?, 'ratchet_secret', '\"x\"')").run(INTRUDER);

    const list = await settingsApp.request('/');
    const settings = (await list.json()) as Record<string, unknown>;
    expect(settings.ratchet_secret).toBeUndefined();

    // Bulk PUT lands on the local user, never anyone else. Must be an
    // allowlisted key — settings writes are validated since #233.
    const put = await settingsApp.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Australia/Sydney' }),
    });
    expect(put.status).toBe(200);
    const row = db
      .prepare("SELECT userId FROM settings WHERE key = 'timezone'")
      .get() as { userId: string };
    expect(row.userId).toBe('local');
    db.prepare("DELETE FROM settings WHERE key = 'timezone'").run();
  });

  test("cloze counts don't leak another user's totals", async () => {
    seedIntruderCloze('c_intruder');
    const res = await clozeApp.request('/counts?language=af');
    const counts = (await res.json()) as Record<string, { total: number }>;
    const total = Object.values(counts).reduce((s, c) => s + c.total, 0);
    expect(total).toBe(0);
  });

  test("API tokens are per-user — lists exclude, revokes 404 on another user's token (#218)", async () => {
    db.prepare(
      `INSERT INTO api_tokens (id, name, tokenHash, scopes, createdAt, userId)
       VALUES ('t_intruder', 'intruder-pat', 'hash_t_intruder', '["*"]', ?, ?)`,
    ).run(TS, INTRUDER);

    const list = await tokensApp.request('/');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 't_intruder')).toBeUndefined();

    const del = await tokensApp.request('/t_intruder', { method: 'DELETE' });
    expect(del.status).toBe(404);
    const survives = db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE id = 't_intruder'").get() as { n: number };
    expect(survives.n).toBe(1);
  });
});

// The #220 extension: every library domain the issue names — collections,
// lessons, journal, stats, chat, groups — plus the import and backup paths.
// Same discipline as above: intruder rows seeded straight into the DB must be
// invisible and immutable through every route.
describe('per-user library ratchet (#220)', () => {
  beforeEach(reset);
  afterEach(reset);

  test("starter seeding is per-user — another user's flag and rows neither block nor leak (#315)", async () => {
    const prevRoot = process.env.STARTER_CONTENT_ROOT;
    process.env.STARTER_CONTENT_ROOT = path.resolve(
      import.meta.dir,
      '../test-fixtures/starter-content',
    );
    try {
      // The intruder has already been seeded: their flag AND their copy of the
      // deterministic starter-es id (two rows under one id = composite PK #279).
      db.prepare(
        "INSERT INTO settings (userId, key, value) VALUES (?, 'starterSeeded:es', 'true')",
      ).run(INTRUDER);
      db.prepare(
        `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
         VALUES ('starter-es', 'Geheime Starter', 'Indringer', 'es', ?, ?, ?)`,
      ).run(TS, TS, INTRUDER);

      // Their flag doesn't read as ours…
      const status = await (await starterApp.request('/status?language=es')).json();
      expect(status).toEqual({ available: true, seeded: false });

      // …their collection doesn't trip the not-empty guard, and our seed lands
      // under the same id for our own tenant.
      const res = await starterApp.request('/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'es' }),
      });
      expect(await res.json()).toEqual({
        seeded: true,
        collectionId: 'starter-es',
        lessonCount: 2,
      });

      const owners = db
        .prepare("SELECT userId, title FROM collections WHERE id = 'starter-es' ORDER BY userId")
        .all() as { userId: string; title: string }[];
      expect(owners.map((o) => o.userId)).toEqual([INTRUDER, 'local']);
      // The intruder's copy is untouched by our seed.
      expect(owners[0].title).toBe('Geheime Starter');
    } finally {
      if (prevRoot === undefined) delete process.env.STARTER_CONTENT_ROOT;
      else process.env.STARTER_CONTENT_ROOT = prevRoot;
    }
  });

  test("collection lists and by-id reads exclude another user's collections", async () => {
    seedIntruderCollection('col_intruder');

    const list = await collectionsApp.request('/?language=af');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'col_intruder')).toBeUndefined();

    expect((await collectionsApp.request('/col_intruder?language=af')).status).toBe(404);
  });

  test("collection mutations no-op on another user's collection", async () => {
    seedIntruderCollection('col_intruder');

    await collectionsApp.request('/col_intruder?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Gekaap' }),
    });
    await collectionsApp.request('/col_intruder?language=af', { method: 'DELETE' });
    await collectionsApp.request('/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['col_intruder'] }),
    });

    const row = db
      .prepare('SELECT title, sortOrder FROM collections WHERE id = ?')
      .get('col_intruder') as { title: string; sortOrder: number };
    expect(row.title).toBe('Geheime Boek'); // PUT didn't land
    expect(row.sortOrder).toBe(0); // reorder didn't land
  });

  test("a collection's lesson list never serves another user's lessons", async () => {
    seedIntruderCollection('col_intruder');
    seedIntruderLesson('les_intruder', 'col_intruder');

    const res = await collectionsApp.request('/col_intruder/lessons');
    const rows = (await res.json()) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  test("lesson by-id routes 404 / no-op on another user's lesson", async () => {
    seedIntruderCollection('col_intruder');
    seedIntruderLesson('les_intruder', 'col_intruder');

    expect((await lessonsApp.request('/les_intruder?language=af')).status).toBe(404);

    const progress = await lessonsApp.request('/les_intruder/progress?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrollPosition: 100, percentComplete: 50 }),
    });
    expect(progress.status).toBe(404);

    await lessonsApp.request('/les_intruder?language=af', { method: 'DELETE' });
    const survives = db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE id = ?').get('les_intruder') as { n: number };
    expect(survives.n).toBe(1);
  });

  test("journal lists exclude and by-id routes 404 on another user's entries", async () => {
    db.prepare(
      `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, language, createdAt, updatedAt, userId)
       VALUES ('j_intruder', 'geheime dagboek', 'draft', 2, '2026-01-01', 'af', ?, ?, ?)`,
    ).run(TS, TS, INTRUDER);

    const list = await journalApp.request('/?language=af');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'j_intruder')).toBeUndefined();

    expect((await journalApp.request('/j_intruder?language=af')).status).toBe(404);

    const put = await journalApp.request('/j_intruder?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'gekaap' }),
    });
    expect(put.status).toBe(404);

    expect((await journalApp.request('/j_intruder?language=af', { method: 'DELETE' })).status).toBe(404);
    const survives = db.prepare("SELECT body FROM journal_entries WHERE id = 'j_intruder'").get() as { body: string };
    expect(survives.body).toBe('geheime dagboek');
  });

  test("stats never include another user's rows — list, streak, activity", async () => {
    db.prepare(
      `INSERT INTO dailyStats (userId, date, language, dictionaryLookups, minutesRead)
       VALUES (?, '2026-01-01', 'af', 9, 30)`,
    ).run(INTRUDER);

    const list = await statsApp.request('/?language=af');
    expect(((await list.json()) as unknown[])).toHaveLength(0);

    const streak = await statsApp.request('/streak');
    const s = (await streak.json()) as { streak: number; longest: number };
    expect(s.longest).toBe(0); // the intruder's active day is not my streak

    const activity = await statsApp.request('/activity');
    expect(((await activity.json()) as unknown[])).toHaveLength(0);
  });

  test("chat history excludes another user's messages, and clearing chat leaves theirs", async () => {
    // A fresh timestamp: the chat routes run a global 7-day TTL sweep
    // (legitimately cross-user), and an expired seed would vanish to the TTL
    // rather than prove the DELETE is user-scoped.
    db.prepare(
      `INSERT INTO chat_messages (id, role, content, createdAt, language, userId)
       VALUES ('m_intruder', 'user', 'geheime boodskap', ?, 'af', ?)`,
    ).run(new Date().toISOString(), INTRUDER);

    const list = await chatApp.request('/?language=af');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'm_intruder')).toBeUndefined();

    await chatApp.request('/?language=af', { method: 'DELETE' });
    const survives = db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id = 'm_intruder'").get() as { n: number };
    expect(survives.n).toBe(1);
  });

  test("group lists exclude and mutations no-op on another user's groups", async () => {
    db.prepare(
      "INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId) VALUES ('g_intruder', 'Geheime Groep', 0, ?, ?)",
    ).run(TS, INTRUDER);

    const list = await groupsApp.request('/');
    const rows = (await list.json()) as { id: string }[];
    expect(rows.find((r) => r.id === 'g_intruder')).toBeUndefined();

    await groupsApp.request('/g_intruder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gekaap' }),
    });
    await groupsApp.request('/g_intruder', { method: 'DELETE' });

    const row = db.prepare("SELECT name FROM collection_groups WHERE id = 'g_intruder'").get() as { name: string };
    expect(row.name).toBe('Geheime Groep');
  });

  test("the backup export contains only the requesting user's rows", async () => {
    seedIntruderCollection('col_intruder');
    seedIntruderLesson('les_intruder', 'col_intruder');
    seedIntruderVocab('v_intruder');
    db.prepare(
      "INSERT INTO dailyStats (userId, date, language, dictionaryLookups) VALUES (?, '2026-01-01', 'af', 9)",
    ).run(INTRUDER);
    db.prepare("INSERT INTO settings (userId, key, value) VALUES (?, 'ratchet_secret', '\"x\"')").run(INTRUDER);

    const res = await dataApp.request('/');
    const backup = (await res.json()) as Record<string, { id?: string; key?: string }[]>;

    expect(backup.collections).toHaveLength(0);
    expect(backup.lessons).toHaveLength(0);
    expect(backup.vocab).toHaveLength(0);
    expect(backup.dailyStats).toHaveLength(0);
    expect(backup.settings.find((s) => s.key === 'ratchet_secret')).toBeUndefined();
  });

  test('restoring a backup stamps every row with the requester, never a userId from the payload', async () => {
    const res = await dataApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: [
          { id: 'col_restored', title: 'Myne Nou', createdAt: TS, lastReadAt: TS, userId: INTRUDER },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const row = db.prepare("SELECT userId FROM collections WHERE id = 'col_restored'").get() as { userId: string };
    expect(row.userId).toBe('local');
  });

  // The cross-tenant overwrite class (#220 → #279): the synthetic-id tenant
  // tables carry a composite PRIMARY KEY (userId, id), so ids are per-tenant —
  // a client-supplied id belonging to another tenant can never conflict with
  // (let alone REPLACE) their row. It lands as the writer's OWN distinct row,
  // and the schema guarantees it even for write sites that forget every guard.

  const COMPOSITE_PK_TABLES = [
    'collections',
    'lessons',
    'vocab',
    'clozeSentences',
    'collection_groups',
    'chat_messages',
    'journal_entries',
  ];

  test('every synthetic-id tenant table keys on (userId, id) — schema ratchet (#279)', () => {
    for (const table of COMPOSITE_PK_TABLES) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[];
      const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      expect(pk, `${table} must key on (userId, id)`).toEqual(['userId', 'id']);
    }
  });

  test('the same id under two tenants is two distinct rows, both directions (#279)', () => {
    // Schema-level: no route guard involved. Direction 1: intruder holds the
    // id first, local takes it too. Direction 2: local holds an id, the
    // intruder takes it too. Neither insert may throw or clobber.
    seedIntruderVocab('v_shared');
    db.prepare(
      `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
       VALUES ('v_shared', 'myne', 'word', 'sin', 'mine', 'new', ?, ?, 'af', 'local')`,
    ).run(TS, TS);

    db.prepare(
      `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
       VALUES ('v_local_first', 'oorspronklik', 'word', 'sin', 'original', 'new', ?, ?, 'af', 'local')`,
    ).run(TS, TS);
    db.prepare(
      `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language, userId)
       VALUES ('v_local_first', 'indringer', 'word', 'sin', 'intruder copy', 'new', ?, ?, 'af', ?)`,
    ).run(TS, TS, INTRUDER);

    const shared = db.prepare("SELECT userId, text FROM vocab WHERE id = 'v_shared' ORDER BY userId").all() as { userId: string; text: string }[];
    expect(shared).toEqual([
      { userId: INTRUDER, text: 'geheim' },
      { userId: 'local', text: 'myne' },
    ]);
    const localFirst = db.prepare("SELECT userId, text FROM vocab WHERE id = 'v_local_first' ORDER BY userId").all() as { userId: string; text: string }[];
    expect(localFirst).toEqual([
      { userId: INTRUDER, text: 'indringer' },
      { userId: 'local', text: 'oorspronklik' },
    ]);
  });

  test("posting vocab with another user's row id leaves theirs untouched and creates the writer's own", async () => {
    seedIntruderVocab('v_intruder');

    const res = await vocabApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'v_intruder', text: 'gekaap', language: 'af' }),
    });
    expect(res.status).toBe(200);

    const theirs = db
      .prepare('SELECT text FROM vocab WHERE id = ? AND userId = ?')
      .get('v_intruder', INTRUDER) as { text: string };
    expect(theirs.text).toBe('geheim');

    const mine = db
      .prepare("SELECT text FROM vocab WHERE id = ? AND userId = 'local'")
      .get('v_intruder') as { text: string };
    expect(mine.text).toBe('gekaap');
  });

  test("bulk cloze upsert with another user's ids leaves theirs untouched and creates the writer's own", async () => {
    seedIntruderCloze('c_intruder');

    const res = await clozeApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { id: 'c_intruder', sentence: 'Gekaapte ___.', clozeWord: 'sin', clozeIndex: 0, translation: 'x', language: 'af' },
      ]),
    });
    expect(res.status).toBe(200);

    const theirs = db
      .prepare('SELECT sentence FROM clozeSentences WHERE id = ? AND userId = ?')
      .get('c_intruder', INTRUDER) as { sentence: string };
    expect(theirs.sentence).toBe('Die ___ is geheim.');

    const mine = db
      .prepare("SELECT sentence FROM clozeSentences WHERE id = ? AND userId = 'local'")
      .get('c_intruder') as { sentence: string };
    expect(mine.sentence).toBe('Gekaapte ___.');
  });

  test("restoring a backup carrying another user's row ids cannot hijack their rows", async () => {
    seedIntruderCollection('col_intruder');
    seedIntruderVocab('v_intruder');

    const res = await dataApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: [{ id: 'col_intruder', title: 'Gekaap', createdAt: TS, lastReadAt: TS }],
        vocab: [{ id: 'v_intruder', text: 'gekaap', translation: 'hijacked' }],
      }),
    });
    expect(res.status).toBe(200);

    // The intruder's rows are untouched…
    const col = db
      .prepare('SELECT title FROM collections WHERE id = ? AND userId = ?')
      .get('col_intruder', INTRUDER) as { title: string };
    expect(col.title).toBe('Geheime Boek');
    const voc = db
      .prepare('SELECT text FROM vocab WHERE id = ? AND userId = ?')
      .get('v_intruder', INTRUDER) as { text: string };
    expect(voc.text).toBe('geheim');

    // …and the restorer gets their own distinct rows under the same ids.
    const myCol = db
      .prepare("SELECT title FROM collections WHERE id = 'col_intruder' AND userId = 'local'")
      .get() as { title: string };
    expect(myCol.title).toBe('Gekaap');
    const myVoc = db
      .prepare("SELECT text FROM vocab WHERE id = 'v_intruder' AND userId = 'local'")
      .get() as { text: string };
    expect(myVoc.text).toBe('gekaap');
  });

  test("mined cloze seeding works for a tenant even when another tenant already holds the bank ids (#220)", async () => {
    const bank = (await import('../lib/sentence-bank-af.json')).default as {
      id: number | string;
      source?: string;
    }[];
    const firstMined = bank.find((s) => s.source === 'mined');
    expect(firstMined).toBeTruthy();

    // Another tenant seeded first (pre-namespacing rows hold the raw bank id).
    db.prepare(
      `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
       VALUES (?, 'Indringer se sin.', 'sin', 0, 'x', 'mined', 'mined', ?, 'af', ?)`,
    ).run(String(firstMined!.id), TS, INTRUDER);

    const res = await clozeApp.request('/seed?language=af', { method: 'POST' });
    expect(res.status).toBe(200);
    const seeded = (await res.json()) as { mined: number };
    // Every mined bank row lands for the requesting tenant — the intruder's
    // rows must not shadow them (the old global-id INSERT OR IGNORE skipped
    // any id another tenant already held).
    expect(seeded.mined).toBeGreaterThan(0);

    const mine = db
      .prepare("SELECT COUNT(*) AS n FROM clozeSentences WHERE userId = 'local' AND source = 'mined' AND language = 'af'")
      .get() as { n: number };
    expect(mine.n).toBe(seeded.mined);

    // The intruder's row is untouched.
    const theirs = db
      .prepare('SELECT userId, sentence FROM clozeSentences WHERE id = ?')
      .get(String(firstMined!.id)) as { userId: string; sentence: string };
    expect(theirs.userId).toBe(INTRUDER);
    expect(theirs.sentence).toBe('Indringer se sin.');
  });

  test('mined cloze re-seeding stays idempotent, including rows seeded before id namespacing', async () => {
    const bank = (await import('../lib/sentence-bank-af.json')).default as {
      id: number | string;
      source?: string;
    }[];
    const legacy = bank.find((s) => s.source === 'mined');

    // One of the local user's mined rows predates namespaced ids (raw bank id).
    db.prepare(
      `INSERT INTO clozeSentences (id, sentence, clozeWord, clozeIndex, translation, source, collection, nextReview, language, userId)
       VALUES (?, 'Ou saad-ry.', 'saad', 0, 'x', 'mined', 'mined', ?, 'af', 'local')`,
    ).run(String(legacy!.id), TS);

    const first = (await (await clozeApp.request('/seed?language=af', { method: 'POST' })).json()) as { mined: number };
    const second = (await (await clozeApp.request('/seed?language=af', { method: 'POST' })).json()) as { mined: number };

    // The legacy row is recognized as already seeded (not duplicated), and a
    // repeat seed inserts nothing new.
    const total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM clozeSentences
          WHERE userId = 'local' AND source = 'mined' AND language = 'af'`,
      )
      .get() as { n: number };
    // total = the legacy row + everything the first seed added; the second seed adds zero.
    expect(total.n).toBe(first.mined + 1);
    expect(second.mined).toBe(0);
  });

  test('an EPUB import stamps the collection and every lesson with the requester (#220)', async () => {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Ratchet Boek</dc:title><dc:creator>Toets</dc:creator><dc:identifier id="uid">ratchet-epub</dc:identifier></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>',
      ),
    );
    zip.addFile(
      'OEBPS/ch1.xhtml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Een</title></head><body><h1>Een</h1><p>Die kat sit op die mat.</p></body></html>',
      ),
    );

    const form = new FormData();
    form.append('file', new File([new Uint8Array(zip.toBuffer())], 'ratchet.epub', { type: 'application/epub+zip' }));
    form.append('language', 'af');

    const res = await importApp.request('/epub', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const { collectionId } = (await res.json()) as { collectionId: string };

    const col = db.prepare('SELECT userId FROM collections WHERE id = ?').get(collectionId) as { userId: string };
    expect(col.userId).toBe('local');

    const lessons = db
      .prepare('SELECT userId FROM lessons WHERE collectionId = ?')
      .all(collectionId) as { userId: string }[];
    expect(lessons.length).toBeGreaterThan(0);
    for (const l of lessons) expect(l.userId).toBe('local');
  });
});
