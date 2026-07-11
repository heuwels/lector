import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  selectPending,
  classifyPendingBatch,
  startClassifyWorker,
  stopClassifyWorker,
  classifyWorkerEnabled,
} from './classify-worker';
import type { ClassifyItem, ClassifyResult } from './word-classifier';

// Minimal mirror of the real schema — just the columns the worker's query and
// writes touch (knownWords compound PK + domain; vocab text/language/context).
function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE knownWords (
      userId TEXT NOT NULL DEFAULT 'local',
      word TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      state TEXT NOT NULL,
      domain TEXT,
      PRIMARY KEY (userId, word, language)
    );
    CREATE TABLE vocab (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL DEFAULT 'local',
      text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'af',
      sentence TEXT NOT NULL DEFAULT '',
      translation TEXT NOT NULL DEFAULT '',
      stateUpdatedAt TEXT NOT NULL DEFAULT '2024-01-01'
    );
  `);
  return db;
}

function addKnown(
  db: Database,
  word: string,
  state: string,
  opts: { language?: string; domain?: string | null; userId?: string } = {},
): void {
  db.prepare(
    'INSERT INTO knownWords (userId, word, language, state, domain) VALUES (?, ?, ?, ?, ?)',
  ).run(opts.userId ?? 'local', word, opts.language ?? 'af', state, opts.domain ?? null);
}

let vocabId = 0;
function addVocab(
  db: Database,
  text: string,
  opts: {
    language?: string;
    sentence?: string;
    translation?: string;
    stateUpdatedAt?: string;
    userId?: string;
  } = {},
): void {
  db.prepare(
    'INSERT INTO vocab (id, userId, text, language, sentence, translation, stateUpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    `v${vocabId++}`,
    opts.userId ?? 'local',
    text,
    opts.language ?? 'af',
    opts.sentence ?? '',
    opts.translation ?? '',
    opts.stateUpdatedAt ?? '2024-01-01',
  );
}

/** Deterministic classifier: tags every word it's given 'food', recording calls. */
function stubFood(
  captured: ClassifyItem[][] = [],
): (items: ClassifyItem[]) => Promise<ClassifyResult[]> {
  return async (items) => {
    captured.push(items);
    return items.map((it) => ({ word: it.word, domain: 'food' as const }));
  };
}

describe('selectPending', () => {
  test('returns only domain-IS-NULL mastery-state rows', () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known');
    addKnown(db, 'brood', 'level2');
    addKnown(db, 'nuut', 'new'); // not a mastery state
    addKnown(db, 'weg', 'ignored'); // not a mastery state
    addKnown(db, 'reeds', 'known', { domain: 'food' }); // already classified
    expect(selectPending(db, 100).map((r) => r.word)).toEqual(['brood', 'koffie']);
  });

  test('respects the limit', () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) addKnown(db, `w${i}`, 'known');
    expect(selectPending(db, 3)).toHaveLength(3);
  });

  test('attaches the richest vocab context — prefers an encounter with a sentence', () => {
    const db = freshDb();
    addKnown(db, 'bank', 'known');
    addVocab(db, 'bank', { translation: 'bank', sentence: '' });
    addVocab(db, 'bank', { translation: 'bank', sentence: 'Ek sit op die bank.' });
    const [row] = selectPending(db, 10);
    expect(row.sentence).toBe('Ek sit op die bank.');
    expect(row.translation).toBe('bank');
  });

  test('a bulk-imported word with no vocab row yields null context', () => {
    const db = freshDb();
    addKnown(db, 'lossewoord', 'known');
    const [row] = selectPending(db, 10);
    expect(row.sentence).toBeNull();
    expect(row.translation).toBeNull();
  });

  test('matches context within the same language only', () => {
    const db = freshDb();
    addKnown(db, 'kos', 'known', { language: 'nl' });
    addVocab(db, 'kos', { language: 'af', translation: 'food', sentence: 'Afrikaans context' });
    const [row] = selectPending(db, 10);
    // The af encounter must NOT leak into the nl row.
    expect(row.translation).toBeNull();
    expect(row.sentence).toBeNull();
  });

  test('sweeps every tenant, not just the local user (#220)', () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known'); // local
    addKnown(db, 'brood', 'known', { userId: 'user-a' });
    addKnown(db, 'wyn', 'level2', { userId: 'user-b' });
    const rows = selectPending(db, 10);
    expect(rows.map((r) => `${r.userId}:${r.word}`).sort()).toEqual([
      'local:koffie',
      'user-a:brood',
      'user-b:wyn',
    ]);
  });

  test("matches context within the same tenant only — another user's encounter never leaks (#220)", () => {
    const db = freshDb();
    addKnown(db, 'bank', 'known', { userId: 'user-a' });
    addVocab(db, 'bank', { userId: 'user-b', translation: 'bench', sentence: 'B se sin.' });
    const [row] = selectPending(db, 10);
    expect(row.userId).toBe('user-a');
    expect(row.translation).toBeNull();
    expect(row.sentence).toBeNull();
  });
});

describe('classifyPendingBatch', () => {
  test('writes a domain to each classified word and leaves non-pending rows untouched', async () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known');
    addKnown(db, 'nuut', 'new'); // skipped: not mastery
    addKnown(db, 'reeds', 'known', { domain: 'work' }); // skipped: already set
    const captured: ClassifyItem[][] = [];
    const n = await classifyPendingBatch(db, 30, stubFood(captured));

    expect(n).toBe(1);
    expect(captured[0].map((i) => i.word)).toEqual(['koffie']);
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('koffie')).toEqual({
      domain: 'food',
    });
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('nuut')).toEqual({
      domain: null,
    });
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('reeds')).toEqual({
      domain: 'work',
    });
  });

  test('is self-draining: a second run after a full drain is a no-op', async () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known');
    addKnown(db, 'brood', 'level3');
    expect(await classifyPendingBatch(db, 30, stubFood())).toBe(2);
    expect(await classifyPendingBatch(db, 30, stubFood())).toBe(0);
  });

  test('writes back by compound PK — same word in two languages updates both rows', async () => {
    const db = freshDb();
    addKnown(db, 'kos', 'known', { language: 'af' });
    addKnown(db, 'kos', 'known', { language: 'nl' });
    await classifyPendingBatch(db, 30, stubFood());
    const rows = db
      .prepare('SELECT language, domain FROM knownWords WHERE word = ? ORDER BY language')
      .all('kos');
    expect(rows).toEqual([
      { language: 'af', domain: 'food' },
      { language: 'nl', domain: 'food' },
    ]);
  });

  test('writes each row to its own tenant — same word for two users updates both, in place (#220)', async () => {
    const db = freshDb();
    addKnown(db, 'kos', 'known', { userId: 'user-a' });
    addKnown(db, 'kos', 'known', { userId: 'user-b' });
    expect(await classifyPendingBatch(db, 30, stubFood())).toBe(2);
    const rows = db
      .prepare('SELECT userId, domain FROM knownWords WHERE word = ? ORDER BY userId')
      .all('kos');
    expect(rows).toEqual([
      { userId: 'user-a', domain: 'food' },
      { userId: 'user-b', domain: 'food' },
    ]);
  });

  test('returns 0 without calling the classifier when nothing is pending', async () => {
    const db = freshDb();
    const n = await classifyPendingBatch(db, 30, async () => {
      throw new Error('classifier should not be called');
    });
    expect(n).toBe(0);
  });

  test('skips words the classifier omitted — they stay NULL for the next sweep', async () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known');
    addKnown(db, 'raaisel', 'known');
    const n = await classifyPendingBatch(db, 30, async (items) =>
      items
        .filter((it) => it.word === 'koffie')
        .map((it) => ({ word: it.word, domain: 'food' as const })),
    );
    expect(n).toBe(1);
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('raaisel')).toEqual({
      domain: null,
    });
  });

  test('propagates classifier failures and leaves every row pending for the next sweep', async () => {
    const db = freshDb();
    addKnown(db, 'koffie', 'known');

    await expect(
      classifyPendingBatch(db, 30, async () => {
        throw new Error('provider unavailable');
      }),
    ).rejects.toThrow('provider unavailable');
    expect(selectPending(db, 30).map((row) => row.word)).toEqual(['koffie']);
  });
});

describe('startClassifyWorker gating', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.CLASSIFY_WORKER;
  });
  afterEach(() => {
    stopClassifyWorker(); // cancel any timers a test created
    if (saved === undefined) delete process.env.CLASSIFY_WORKER;
    else process.env.CLASSIFY_WORKER = saved;
  });

  test('does not boot when CLASSIFY_WORKER is unset', () => {
    delete process.env.CLASSIFY_WORKER;
    expect(classifyWorkerEnabled()).toBe(false);
    expect(startClassifyWorker()).toBe(false);
  });

  test('boots when CLASSIFY_WORKER=1', () => {
    process.env.CLASSIFY_WORKER = '1';
    expect(classifyWorkerEnabled()).toBe(true);
    // Returns true synchronously; afterEach stops the loop before any tick fires.
    expect(startClassifyWorker()).toBe(true);
  });
});
