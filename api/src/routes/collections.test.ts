import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import app from '../routes/collections';

function setLang(code: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'targetLanguage',
    JSON.stringify(code),
  );
}

function reset() {
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
  db.prepare('DELETE FROM collection_groups').run();
  db.prepare("DELETE FROM settings WHERE key = 'targetLanguage'").run();
}

function insertCollection(
  id: string,
  opts: { sortOrder?: number; lastReadAt?: string; groupId?: string | null } = {},
) {
  db.prepare(
    `INSERT INTO collections (id, title, author, coverUrl, groupId, sortOrder, language, createdAt, lastReadAt)
     VALUES (?, ?, 'Author', NULL, ?, ?, 'af', '2026-01-01T00:00:00Z', ?)`,
  ).run(id, `Title ${id}`, opts.groupId ?? null, opts.sortOrder ?? 0, opts.lastReadAt ?? '2026-01-01T00:00:00Z');
}

function insertLesson(id: string, collectionId: string, sortOrder: number) {
  db.prepare(
    `INSERT INTO lessons (id, collectionId, title, sortOrder, language, textContent, createdAt, lastReadAt)
     VALUES (?, ?, ?, ?, 'af', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(id, collectionId, `Lesson ${id}`, sortOrder);
}

function sortOrderOf(table: 'collections' | 'lessons', id: string): number {
  return (db.prepare(`SELECT sortOrder FROM ${table} WHERE id = ?`).get(id) as { sortOrder: number }).sortOrder;
}

describe('collections route', () => {
  beforeEach(() => {
    reset();
    setLang('af');
  });
  afterEach(reset);

  test('PUT /reorder assigns sortOrder by array index', async () => {
    insertCollection('a');
    insertCollection('b');
    insertCollection('c');
    const res = await app.request('/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['c', 'a', 'b'] }),
    });
    expect(res.status).toBe(200);
    expect(sortOrderOf('collections', 'c')).toBe(0);
    expect(sortOrderOf('collections', 'a')).toBe(1);
    expect(sortOrderOf('collections', 'b')).toBe(2);
  });

  test('PUT /reorder rejects a non-array body with 400 (and is not captured by /:id)', async () => {
    const res = await app.request('/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  test('GET / orders by sortOrder ASC then lastReadAt DESC', async () => {
    insertCollection('a', { sortOrder: 2 });
    insertCollection('b', { sortOrder: 0 });
    insertCollection('c', { sortOrder: 1 });
    insertCollection('d', { sortOrder: 0, lastReadAt: '2026-05-01T00:00:00Z' });
    const res = await app.request('/?language=af');
    const data = (await res.json()) as { id: string }[];
    expect(data.map((c) => c.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  test('POST / persists groupId when provided, defaults to null when omitted', async () => {
    const withGroup = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New', groupId: 'grp-1', language: 'af' }),
    });
    const { id: id1 } = (await withGroup.json()) as { id: string };
    expect((db.prepare('SELECT groupId FROM collections WHERE id = ?').get(id1) as { groupId: string | null }).groupId).toBe('grp-1');

    const loose = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Loose', language: 'af' }),
    });
    const { id: id2 } = (await loose.json()) as { id: string };
    expect((db.prepare('SELECT groupId FROM collections WHERE id = ?').get(id2) as { groupId: string | null }).groupId).toBeNull();
  });

  test('PUT /:id/lessons/reorder is scoped to the collection', async () => {
    insertCollection('col-1');
    insertCollection('col-2');
    insertLesson('mine', 'col-1', 0);
    insertLesson('theirs', 'col-2', 7);
    const res = await app.request('/col-1/lessons/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['theirs', 'mine'] }),
    });
    expect(res.status).toBe(200);
    // `theirs` is in col-2, so the col-1-scoped update must not touch it.
    expect(sortOrderOf('lessons', 'theirs')).toBe(7);
    expect(sortOrderOf('lessons', 'mine')).toBe(1);
  });
});
