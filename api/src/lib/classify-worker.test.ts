import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  selectPending,
  classifyPendingBatch,
  startClassifyWorker,
  stopClassifyWorker,
  classifyWorkerEnabled,
  batchClassificationEnabled,
  getInflightBatch,
  submitClassifyBatch,
  pollClassifyBatch,
  purgeOrphanedBatches,
  type BatchClassifyProvider,
} from './classify-worker';
import type { ClassifyItem, ClassifyResult } from './word-classifier';
import type { BatchRequest, BatchStatus } from './llm';

// Minimal mirror of the real schema — just the columns the worker's query and
// writes touch (knownWords compound PK + domain; vocab text/language/context),
// plus the classify_batches bookkeeping table batch mode persists into.
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
    CREATE TABLE classify_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      providerBatchId TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      submittedAt TEXT NOT NULL,
      requests TEXT NOT NULL
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

/** Batch provider stub: records createBatch payloads, serves scripted polls. */
function stubBatchProvider(
  poll: (batchId: string) => BatchStatus,
  options: { supports?: boolean; batchId?: string } = {},
): BatchClassifyProvider & { created: BatchRequest[][] } {
  const created: BatchRequest[][] = [];
  return {
    name: 'anthropic',
    created,
    supportsBatch: () => options.supports ?? true,
    createBatch: async (requests) => {
      created.push(requests);
      return options.batchId ?? 'msgbatch_test';
    },
    getBatch: async (batchId) => poll(batchId),
  };
}

const neverPolled = () => {
  throw new Error('getBatch should not be called');
};

describe('batchClassificationEnabled', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.CLASSIFY_BATCH;
    delete process.env.CLASSIFY_BATCH;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CLASSIFY_BATCH;
    else process.env.CLASSIFY_BATCH = saved;
  });

  test('on when the provider supports batching', () => {
    expect(batchClassificationEnabled(stubBatchProvider(neverPolled))).toBe(true);
  });

  test('off for providers without a batch surface', () => {
    expect(batchClassificationEnabled(stubBatchProvider(neverPolled, { supports: false }))).toBe(
      false,
    );
    // OpenAI-compatible providers don't define the methods at all.
    expect(batchClassificationEnabled({ name: 'openai' })).toBe(false);
  });

  test('CLASSIFY_BATCH=0 forces the synchronous path', () => {
    process.env.CLASSIFY_BATCH = '0';
    expect(batchClassificationEnabled(stubBatchProvider(neverPolled))).toBe(false);
  });
});

describe('submitClassifyBatch', () => {
  test('chunks pending words into batchSize prompts and records the in-flight batch', async () => {
    const db = freshDb();
    for (const word of ['appel', 'brood', 'melk', 'kaas', 'wyn']) addKnown(db, word, 'known');
    const provider = stubBatchProvider(neverPolled);

    const submitted = await submitClassifyBatch(db, provider, 2, 10);

    expect(submitted).toBe(5);
    expect(provider.created).toHaveLength(1);
    const requests = provider.created[0];
    expect(requests.map((r) => r.customId)).toEqual(['req-0', 'req-1', 'req-2']);
    expect(requests.map((r) => r.options.messages[0].content.includes('"appel"'))).toEqual([
      true,
      false,
      false,
    ]);
    for (const request of requests) {
      expect(request.options.task).toBe('word-classification');
      expect(request.options.responseFormat).toBe('json-array');
      expect(request.options.maxTokens).toBeGreaterThan(0);
    }

    const inflight = getInflightBatch(db);
    expect(inflight?.providerBatchId).toBe('msgbatch_test');
    expect(inflight?.requests.map((r) => r.rows.length)).toEqual([2, 2, 1]);
  });

  test('caps one submission at batchSize × maxRequests words', async () => {
    const db = freshDb();
    for (let i = 0; i < 7; i++) addKnown(db, `woord${i}`, 'known');
    const provider = stubBatchProvider(neverPolled);
    expect(await submitClassifyBatch(db, provider, 2, 2)).toBe(4);
    expect(provider.created[0]).toHaveLength(2);
  });

  test('never stacks batches: a submit while one is in flight is a no-op', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    const provider = stubBatchProvider(neverPolled);
    expect(await submitClassifyBatch(db, provider, 30, 40)).toBe(1);
    expect(await submitClassifyBatch(db, provider, 30, 40)).toBe(0);
    expect(provider.created).toHaveLength(1);
  });

  test('submits nothing when no words are pending', async () => {
    const db = freshDb();
    const provider = stubBatchProvider(neverPolled);
    expect(await submitClassifyBatch(db, provider, 30, 40)).toBe(0);
    expect(provider.created).toHaveLength(0);
    expect(getInflightBatch(db)).toBeNull();
  });

  test('records nothing when the provider rejects the batch — words stay pending', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    const provider: BatchClassifyProvider = {
      name: 'anthropic',
      supportsBatch: () => true,
      createBatch: async () => {
        throw new Error('overloaded');
      },
      getBatch: async () => ({ state: 'in_progress' }),
    };
    await expect(submitClassifyBatch(db, provider, 30, 40)).rejects.toThrow('overloaded');
    expect(getInflightBatch(db)).toBeNull();
    expect(selectPending(db, 10)).toHaveLength(1);
  });
});

describe('pollClassifyBatch', () => {
  const foodText = (words: string[]) =>
    JSON.stringify(words.map((word) => ({ word, domain: 'food' })));

  test('reports none when nothing is in flight', async () => {
    const db = freshDb();
    expect(await pollClassifyBatch(db, stubBatchProvider(neverPolled))).toEqual({ state: 'none' });
  });

  test('keeps the batch while the provider is still processing', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    const provider = stubBatchProvider(() => ({ state: 'in_progress' }));
    await submitClassifyBatch(db, provider, 30, 40);

    expect(await pollClassifyBatch(db, provider)).toEqual({ state: 'in_progress' });
    expect(getInflightBatch(db)).not.toBeNull();
  });

  test('on completion writes domains to exactly the submitted rows and re-arms submission', async () => {
    const db = freshDb();
    addKnown(db, 'kos', 'known', { userId: 'user-a' });
    addKnown(db, 'kos', 'known', { userId: 'user-b' }); // same word, second tenant
    addKnown(db, 'raaisel', 'known'); // model will omit this one
    const provider = stubBatchProvider(() => ({
      state: 'ended',
      results: new Map([['req-0', foodText(['kos'])]]),
    }));
    await submitClassifyBatch(db, provider, 30, 40);

    const outcome = await pollClassifyBatch(db, provider);

    expect(outcome).toEqual({ state: 'ended', updated: 2 });
    const rows = db
      .prepare('SELECT userId, domain FROM knownWords WHERE word = ? ORDER BY userId')
      .all('kos');
    expect(rows).toEqual([
      { userId: 'user-a', domain: 'food' },
      { userId: 'user-b', domain: 'food' },
    ]);
    // Omitted word: still pending for the next submission.
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('raaisel')).toEqual({
      domain: null,
    });
    expect(getInflightBatch(db)).toBeNull();
  });

  test('spans multiple requests and survives one garbled response', async () => {
    const db = freshDb();
    for (const word of ['appel', 'brood', 'melk', 'kaas']) addKnown(db, word, 'known');
    const provider = stubBatchProvider(() => ({
      state: 'ended',
      results: new Map([
        ['req-0', 'NOT JSON AT ALL'], // first prompt garbled → classifies nothing
        ['req-1', foodText(['kaas', 'melk'])],
      ]),
    }));
    await submitClassifyBatch(db, provider, 2, 10);

    const outcome = await pollClassifyBatch(db, provider);
    expect(outcome).toEqual({ state: 'ended', updated: 2 });
    const domains = db
      .prepare('SELECT word, domain FROM knownWords ORDER BY word')
      .all() as { word: string; domain: string | null }[];
    expect(domains).toEqual([
      { word: 'appel', domain: null },
      { word: 'brood', domain: null },
      { word: 'kaas', domain: 'food' },
      { word: 'melk', domain: 'food' },
    ]);
  });

  test('never rewrites a domain set while the batch was in flight', async () => {
    const db = freshDb();
    addKnown(db, 'kos', 'known');
    const provider = stubBatchProvider(() => ({
      state: 'ended',
      results: new Map([['req-0', foodText(['kos'])]]),
    }));
    await submitClassifyBatch(db, provider, 30, 40);
    // Classified through some other path mid-flight.
    db.prepare('UPDATE knownWords SET domain = ? WHERE word = ?').run('work', 'kos');

    const outcome = await pollClassifyBatch(db, provider);
    expect(outcome).toEqual({ state: 'ended', updated: 0 });
    expect(db.prepare('SELECT domain FROM knownWords WHERE word = ?').get('kos')).toEqual({
      domain: 'work',
    });
  });

  test('a terminally failed batch is dropped so the next tick resubmits', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    const provider = stubBatchProvider(() => ({ state: 'failed', error: 'batch not found' }));
    await submitClassifyBatch(db, provider, 30, 40);

    expect(await pollClassifyBatch(db, provider)).toEqual({
      state: 'failed',
      error: 'batch not found',
    });
    expect(getInflightBatch(db)).toBeNull();
    expect(selectPending(db, 10)).toHaveLength(1); // still pending — resubmitted next tick
  });

  test('transient poll errors keep the batch for the next tick', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    let polls = 0;
    const provider = stubBatchProvider(() => {
      polls++;
      throw new Error('ECONNRESET');
    });
    await submitClassifyBatch(db, provider, 30, 40);

    await expect(pollClassifyBatch(db, provider)).rejects.toThrow('ECONNRESET');
    expect(polls).toBe(1);
    expect(getInflightBatch(db)).not.toBeNull(); // still there — polled again next tick
  });
});

describe('purgeOrphanedBatches', () => {
  test('clears bookkeeping when batch mode goes away', async () => {
    const db = freshDb();
    addKnown(db, 'appel', 'known');
    const provider = stubBatchProvider(neverPolled);
    await submitClassifyBatch(db, provider, 30, 40);

    expect(purgeOrphanedBatches(db)).toBe(1);
    expect(getInflightBatch(db)).toBeNull();
    expect(purgeOrphanedBatches(db)).toBe(0); // idempotent, quiet when empty
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
