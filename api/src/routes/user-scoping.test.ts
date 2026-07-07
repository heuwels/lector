import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import AdmZip from 'adm-zip';
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
});

// The #220 extension: every library domain the issue names — collections,
// lessons, journal, stats, chat, groups — plus the import and backup paths.
// Same discipline as above: intruder rows seeded straight into the DB must be
// invisible and immutable through every route.
describe('per-user library ratchet (#220)', () => {
  beforeEach(reset);
  afterEach(reset);

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
