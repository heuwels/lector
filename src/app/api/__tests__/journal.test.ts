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
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      correctedBody TEXT,
      corrections TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
      wordCount INTEGER DEFAULT 0,
      entryDate TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_entryDate ON journal_entries(entryDate);
    CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status);
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

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}

function insertEntry(
  id: string,
  body: string,
  entryDate: string,
  status: string = 'draft',
  createdAt?: string
) {
  const now = createdAt || new Date().toISOString();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  sqlite
    .prepare(
      `INSERT INTO journal_entries (id, body, status, wordCount, entryDate, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, body, status, wordCount, entryDate, now, now);
}

// ═══════════════════════════════════════════════════════════════════════════
// JOURNAL API TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Journal API', () => {
  let listRoute: typeof import('@/app/api/journal/route');
  let itemRoute: typeof import('@/app/api/journal/[id]/route');

  beforeEach(async () => {
    listRoute = await import('@/app/api/journal/route');
    itemRoute = await import('@/app/api/journal/[id]/route');
  });

  // ── GET /api/journal ────────────────────────────────────────────────────

  describe('GET /api/journal', () => {
    it('returns empty array when no entries', async () => {
      const res = await listRoute.GET(makeRequest('/api/journal'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('returns entries in reverse chronological order by createdAt', async () => {
      insertEntry('a', 'Dag een', '2026-01-01', 'draft', '2026-01-01T10:00:00Z');
      insertEntry('b', 'Dag twee', '2026-01-02', 'draft', '2026-01-02T10:00:00Z');
      insertEntry('c', 'Dag drie', '2026-01-03', 'draft', '2026-01-03T10:00:00Z');

      const res = await listRoute.GET(makeRequest('/api/journal'));
      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0].id).toBe('c');
      expect(data[1].id).toBe('b');
      expect(data[2].id).toBe('a');
    });

    it('returns entries filtered by date', async () => {
      insertEntry('a', 'Morning entry', '2026-03-15', 'draft', '2026-03-15T08:00:00Z');
      insertEntry('b', 'Evening entry', '2026-03-15', 'draft', '2026-03-15T20:00:00Z');
      insertEntry('c', 'Different day', '2026-03-16', 'draft', '2026-03-16T10:00:00Z');

      const res = await listRoute.GET(
        makeRequest('/api/journal?date=2026-03-15')
      );
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('b'); // most recent first
      expect(data[1].id).toBe('a');
    });

    it('returns empty array for non-existent date', async () => {
      const res = await listRoute.GET(
        makeRequest('/api/journal?date=2099-12-31')
      );
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('allows multiple entries per day', async () => {
      insertEntry('a', 'First entry', '2026-04-10', 'submitted', '2026-04-10T08:00:00Z');
      insertEntry('b', 'Second entry', '2026-04-10', 'draft', '2026-04-10T20:00:00Z');

      const res = await listRoute.GET(makeRequest('/api/journal?date=2026-04-10'));
      const data = await res.json();
      expect(data).toHaveLength(2);
    });

    it('respects limit and offset', async () => {
      insertEntry('a', 'Een', '2026-01-01', 'draft', '2026-01-01T10:00:00Z');
      insertEntry('b', 'Twee', '2026-01-02', 'draft', '2026-01-02T10:00:00Z');
      insertEntry('c', 'Drie', '2026-01-03', 'draft', '2026-01-03T10:00:00Z');

      const res = await listRoute.GET(
        makeRequest('/api/journal?limit=1&offset=1')
      );
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('b');
    });
  });

  // ── POST /api/journal ───────────────────────────────────────────────────

  describe('POST /api/journal', () => {
    it('creates a new draft entry', async () => {
      const res = await listRoute.POST(
        makeRequest('/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Vandag was lekker.', entryDate: '2026-04-10' }),
        })
      );
      expect(res.status).toBe(200);
      const { id, entryDate } = await res.json();
      expect(id).toBeTruthy();
      expect(entryDate).toBe('2026-04-10');

      const row = sqlite.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row.body).toBe('Vandag was lekker.');
      expect(row.status).toBe('draft');
      expect(row.wordCount).toBe(3);
    });

    it('creates a second entry for the same date', async () => {
      insertEntry('first', 'First entry', '2026-04-10', 'submitted');

      const res = await listRoute.POST(
        makeRequest('/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Second entry', entryDate: '2026-04-10' }),
        })
      );
      expect(res.status).toBe(200);
      const { id } = await res.json();
      expect(id).not.toBe('first');

      const count = sqlite.prepare('SELECT COUNT(*) as c FROM journal_entries WHERE entryDate = ?').get('2026-04-10') as { c: number };
      expect(count.c).toBe(2);
    });
  });

  // ── GET /api/journal/[id] ──────────────────────────────────────────────

  describe('GET /api/journal/[id]', () => {
    it('returns entry by id', async () => {
      insertEntry('test-id', 'Toets inhoud', '2026-05-01');

      const res = await itemRoute.GET(
        makeRequest('/api/journal/test-id'),
        { params: Promise.resolve({ id: 'test-id' }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.body).toBe('Toets inhoud');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await itemRoute.GET(
        makeRequest('/api/journal/nope'),
        { params: Promise.resolve({ id: 'nope' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/journal/[id] ──────────────────────────────────────────────

  describe('PUT /api/journal/[id]', () => {
    it('updates draft body', async () => {
      insertEntry('draft-1', 'Ou teks', '2026-06-01');

      const res = await itemRoute.PUT(
        makeRequest('/api/journal/draft-1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Opgedateer' }),
        }),
        { params: Promise.resolve({ id: 'draft-1' }) }
      );
      expect(res.status).toBe(200);

      const row = sqlite.prepare('SELECT body, wordCount FROM journal_entries WHERE id = ?').get('draft-1') as Record<string, unknown>;
      expect(row.body).toBe('Opgedateer');
      expect(row.wordCount).toBe(1);
    });

    it('rejects editing a submitted entry', async () => {
      insertEntry('sub-1', 'Submitted teks', '2026-06-01', 'submitted');

      const res = await itemRoute.PUT(
        makeRequest('/api/journal/sub-1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Probeer verander' }),
        }),
        { params: Promise.resolve({ id: 'sub-1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent entry', async () => {
      const res = await itemRoute.PUT(
        makeRequest('/api/journal/nope', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'anything' }),
        }),
        { params: Promise.resolve({ id: 'nope' }) }
      );
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/journal/[id] ───────────────────────────────────────────

  describe('DELETE /api/journal/[id]', () => {
    it('deletes an entry', async () => {
      insertEntry('del-1', 'Te verwyder', '2026-07-01');

      const res = await itemRoute.DELETE(
        makeRequest('/api/journal/del-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'del-1' }) }
      );
      expect(res.status).toBe(200);

      const row = sqlite.prepare('SELECT id FROM journal_entries WHERE id = ?').get('del-1');
      expect(row).toBeUndefined();
    });

    it('returns 404 for non-existent entry', async () => {
      const res = await itemRoute.DELETE(
        makeRequest('/api/journal/nope', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'nope' }) }
      );
      expect(res.status).toBe(404);
    });
  });
});
