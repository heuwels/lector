import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ── In-memory DB wiring ─────────────────────────────────────────────────────

let sqlite: InstanceType<typeof Database>;

vi.mock('@/lib/server/database', () => {
  return {
    get db() {
      return sqlite;
    },
  };
});

function createTables() {
  sqlite.exec(`
    CREATE TABLE collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'Unknown',
      coverUrl TEXT,
      groupId TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'af',
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL
    );

    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      collectionId TEXT,
      title TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'af',
      textContent TEXT NOT NULL DEFAULT '',
      progress_scrollPosition INTEGER DEFAULT 0,
      progress_percentComplete REAL DEFAULT 0,
      wordCount INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      lastReadAt TEXT NOT NULL
    );

    CREATE TABLE collection_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES ('targetLanguage', 'af');
  `);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  createTables();
});

afterEach(() => {
  sqlite.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init) as unknown as import('next/server').NextRequest;
}

function insertCollection(
  id: string,
  opts: { sortOrder?: number; lastReadAt?: string; groupId?: string | null } = {}
) {
  const now = '2026-01-01T00:00:00Z';
  sqlite
    .prepare(
      `INSERT INTO collections (id, title, author, coverUrl, groupId, sortOrder, language, createdAt, lastReadAt)
       VALUES (?, ?, 'Author', NULL, ?, ?, 'af', ?, ?)`
    )
    .run(id, `Title ${id}`, opts.groupId ?? null, opts.sortOrder ?? 0, now, opts.lastReadAt ?? now);
}

function insertLesson(id: string, collectionId: string, sortOrder: number) {
  const now = '2026-01-01T00:00:00Z';
  sqlite
    .prepare(
      `INSERT INTO lessons (id, collectionId, title, sortOrder, language, createdAt, lastReadAt)
       VALUES (?, ?, ?, ?, 'af', ?, ?)`
    )
    .run(id, collectionId, `Lesson ${id}`, sortOrder, now, now);
}

function sortOrderOf(table: 'collections' | 'lessons', id: string): number {
  const row = sqlite.prepare(`SELECT sortOrder FROM ${table} WHERE id = ?`).get(id) as { sortOrder: number };
  return row.sortOrder;
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION REORDER + CREATE-WITH-GROUP
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/collections/reorder', () => {
  let route: typeof import('@/app/api/collections/reorder/route');
  beforeEach(async () => {
    route = await import('@/app/api/collections/reorder/route');
  });

  it('assigns sortOrder by array index', async () => {
    insertCollection('a', { sortOrder: 0 });
    insertCollection('b', { sortOrder: 1 });
    insertCollection('c', { sortOrder: 2 });

    const res = await route.PUT(
      makeRequest('/api/collections/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['c', 'a', 'b'] }),
      })
    );
    expect(res.status).toBe(200);

    expect(sortOrderOf('collections', 'c')).toBe(0);
    expect(sortOrderOf('collections', 'a')).toBe(1);
    expect(sortOrderOf('collections', 'b')).toBe(2);
  });

  it('rejects a non-array body with 400', async () => {
    const res = await route.PUT(
      makeRequest('/api/collections/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: 'nope' }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/collections ordering', () => {
  let route: typeof import('@/app/api/collections/route');
  beforeEach(async () => {
    route = await import('@/app/api/collections/route');
  });

  it('orders by sortOrder ASC, then lastReadAt DESC as a tiebreaker', async () => {
    // Explicit sortOrder wins.
    insertCollection('a', { sortOrder: 2 });
    insertCollection('b', { sortOrder: 0 });
    insertCollection('c', { sortOrder: 1 });
    // Two at the same sortOrder fall back to most-recently-read first.
    insertCollection('d', { sortOrder: 0, lastReadAt: '2026-05-01T00:00:00Z' });

    const res = await route.GET(makeRequest('/api/collections?language=af'));
    const data = (await res.json()) as { id: string }[];
    expect(data.map((c) => c.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('POST /api/collections with groupId', () => {
  let route: typeof import('@/app/api/collections/route');
  beforeEach(async () => {
    route = await import('@/app/api/collections/route');
  });

  it('persists the groupId when provided', async () => {
    const res = await route.POST(
      makeRequest('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New', groupId: 'grp-1', language: 'af' }),
      })
    );
    expect(res.status).toBe(200);
    const { id } = await res.json();

    const row = sqlite.prepare('SELECT groupId FROM collections WHERE id = ?').get(id) as { groupId: string | null };
    expect(row.groupId).toBe('grp-1');
  });

  it('defaults groupId to null when omitted', async () => {
    const res = await route.POST(
      makeRequest('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Loose', language: 'af' }),
      })
    );
    const { id } = await res.json();
    const row = sqlite.prepare('SELECT groupId FROM collections WHERE id = ?').get(id) as { groupId: string | null };
    expect(row.groupId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LESSON REORDER
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/collections/[id]/lessons/reorder', () => {
  let route: typeof import('@/app/api/collections/[id]/lessons/reorder/route');
  beforeEach(async () => {
    route = await import('@/app/api/collections/[id]/lessons/reorder/route');
  });

  it('assigns lesson sortOrder by array index', async () => {
    insertCollection('col-1');
    insertLesson('l1', 'col-1', 0);
    insertLesson('l2', 'col-1', 1);
    insertLesson('l3', 'col-1', 2);

    const res = await route.PUT(
      makeRequest('/api/collections/col-1/lessons/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['l3', 'l1', 'l2'] }),
      }),
      { params: Promise.resolve({ id: 'col-1' }) }
    );
    expect(res.status).toBe(200);

    expect(sortOrderOf('lessons', 'l3')).toBe(0);
    expect(sortOrderOf('lessons', 'l1')).toBe(1);
    expect(sortOrderOf('lessons', 'l2')).toBe(2);
  });

  it('is scoped to the collection — cannot reorder another collection\'s lesson', async () => {
    insertCollection('col-1');
    insertCollection('col-2');
    insertLesson('mine', 'col-1', 0);
    insertLesson('theirs', 'col-2', 7);

    await route.PUT(
      makeRequest('/api/collections/col-1/lessons/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['theirs', 'mine'] }),
      }),
      { params: Promise.resolve({ id: 'col-1' }) }
    );

    // `theirs` belongs to col-2, so the col-1-scoped update must not touch it.
    expect(sortOrderOf('lessons', 'theirs')).toBe(7);
    // `mine` was at index 1 in the submitted order.
    expect(sortOrderOf('lessons', 'mine')).toBe(1);
  });

  it('rejects a non-array body with 400', async () => {
    insertCollection('col-1');
    const res = await route.PUT(
      makeRequest('/api/collections/col-1/lessons/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: 42 }),
      }),
      { params: Promise.resolve({ id: 'col-1' }) }
    );
    expect(res.status).toBe(400);
  });
});
