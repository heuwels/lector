import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('../routes/anki');

// Addon endpoints (#241): queue → pending → ack lifecycle, structured review
// push (upgrade-only reconcile + import, mirroring the browser sync), and the
// SECURITY-04 action allowlist on the AnkiConnect proxy.

const TS = '2026-01-01T00:00:00Z';

function seedVocab(
  id: string,
  text: string,
  opts: { state?: string; sentence?: string; translation?: string; language?: string } = {},
) {
  db.prepare(
    `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language)
     VALUES (?, ?, 'word', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    text,
    opts.sentence ?? 'Die huis is groot.',
    opts.translation ?? 'The house is big.',
    opts.state ?? 'new',
    TS,
    TS,
    opts.language ?? 'af',
  );
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pendingRows(): Array<{ vocabId: string; cardType: string }> {
  return db
    .prepare('SELECT vocabId, cardType FROM anki_pending ORDER BY vocabId, cardType')
    .all() as Array<{
    vocabId: string;
    cardType: string;
  }>;
}

function vocabRow(
  id: string,
): { state: string; pushedToAnki: number; ankiNoteId: number | null } | undefined {
  return db.prepare('SELECT state, pushedToAnki, ankiNoteId FROM vocab WHERE id = ?').get(id) as
    | { state: string; pushedToAnki: number; ankiNoteId: number | null }
    | undefined;
}

function clear() {
  db.prepare('DELETE FROM vocab').run();
  db.prepare('DELETE FROM anki_pending').run();
  db.prepare("DELETE FROM knownWords WHERE userId = 'local'").run();
  db.prepare("DELETE FROM dailyStats WHERE userId = 'local'").run();
}

describe('POST /api/anki proxy allowlist (SECURITY-04)', () => {
  test('disallowed actions are refused without touching AnkiConnect', async () => {
    const realFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    try {
      for (const action of ['importPackage', 'guiBrowse', 'multi', 'deleteDecks']) {
        const res = await post('/', { action });
        expect(res.status).toBe(403);
      }
      const missing = await post('/', {});
      expect(missing.status).toBe(403);
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('allowlisted actions pass through to AnkiConnect', async () => {
    const realFetch = globalThis.fetch;
    const actions: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      actions.push((JSON.parse(init?.body as string) as { action: string }).action);
      return new Response(JSON.stringify({ result: 6, error: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const res = await post('/', { action: 'version' });
      expect(res.status).toBe(200);
      expect((await res.json()) as { result: number; error: null }).toEqual({
        result: 6,
        error: null,
      });
      expect(actions).toEqual(['version']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('AnkiConnect connection and proxy errors', () => {
  test('GET reports the connected version and deck list', async () => {
    const realFetch = globalThis.fetch;
    const actions: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const action = (JSON.parse(init?.body as string) as { action: string }).action;
      actions.push(action);
      return Response.json({
        result: action === 'version' ? 6 : ['Default', 'Lector'],
        error: null,
      });
    }) as unknown as typeof fetch;
    try {
      const response = await app.request('/');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        connected: true,
        version: 6,
        decks: ['Default', 'Lector'],
      });
      expect(actions.sort()).toEqual(['deckNames', 'version']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('GET maps an unreachable AnkiConnect to a disconnected response', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Anki is not running');
    }) as unknown as typeof fetch;
    try {
      const response = await app.request('/');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        connected: false,
        error: 'Anki is not running',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('POST maps HTTP and timeout failures and always supplies an abort signal', async () => {
    const realFetch = globalThis.fetch;
    const signals: AbortSignal[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      call += 1;
      if (call === 1) return new Response('down', { status: 503 });
      throw new DOMException('The operation timed out', 'TimeoutError');
    }) as unknown as typeof fetch;
    try {
      const upstream = await post('/', { action: 'version' });
      expect(upstream.status).toBe(500);
      expect(await upstream.json()).toEqual({
        result: null,
        error: 'AnkiConnect HTTP error: 503',
      });

      const timeout = await post('/', { action: 'version' });
      expect(timeout.status).toBe(500);
      expect(await timeout.json()).toEqual({
        result: null,
        error: 'The operation timed out',
      });
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('POST /api/anki/sync-reviews', () => {
  const intruder = 'anki-route-intruder';

  beforeEach(() => {
    db.prepare("DELETE FROM settings WHERE key = 'ankiConnectUrl' AND userId IN ('local', ?)").run(
      intruder,
    );
    db.prepare("DELETE FROM dailyStats WHERE userId = 'local'").run();
  });
  afterEach(() => {
    db.prepare("DELETE FROM settings WHERE key = 'ankiConnectUrl' AND userId IN ('local', ?)").run(
      intruder,
    );
    db.prepare("DELETE FROM dailyStats WHERE userId = 'local'").run();
  });

  test('uses the current tenant URL and stores only valid normalized review days', async () => {
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      'local',
      'ankiConnectUrl',
      '"https://local-anki.example/v1"',
    );
    db.prepare('INSERT INTO settings (userId, key, value) VALUES (?, ?, ?)').run(
      intruder,
      'ankiConnectUrl',
      '"https://intruder-anki.example/v1"',
    );
    const realFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        result: [
          ['2026-07-13', 3],
          ['invalid-date', 99],
          ['2026-07-13', 4],
        ],
        error: null,
      });
    }) as unknown as typeof fetch;
    try {
      const response = await post('/sync-reviews', {});

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ connected: true, synced: 1 });
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('https://local-anki.example/v1');
      expect(await requests[0].json()).toMatchObject({
        action: 'getNumCardsReviewedByDay',
        version: 6,
      });
      expect(
        db
          .prepare("SELECT date, ankiReviews FROM dailyStats WHERE userId = 'local' ORDER BY date")
          .all(),
      ).toEqual([{ date: '2026-07-13', ankiReviews: 4 }]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('leaves previously synced rows untouched when AnkiConnect is unavailable', async () => {
    db.prepare(
      `INSERT INTO dailyStats (userId, date, language, ankiReviews)
       VALUES ('local', '2026-07-12', 'af', 7)`,
    ).run();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    try {
      const response = await post('/sync-reviews', {});

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        connected: false,
        synced: 0,
        error: 'connection refused',
      });
      expect(
        db
          .prepare(
            "SELECT ankiReviews FROM dailyStats WHERE userId = 'local' AND date = '2026-07-12'",
          )
          .get(),
      ).toEqual({ ankiReviews: 7 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('POST /api/anki/queue', () => {
  beforeEach(clear);
  afterEach(clear);

  test('queues basic/word/cloze cards for existing entries', async () => {
    seedVocab('v1', 'huis');
    seedVocab('v2', 'groot');

    const res = await post('/queue', {
      items: [
        { id: 'v1', cardType: 'basic' },
        { id: 'v1', cardType: 'cloze' },
        { id: 'v2', cardType: 'word' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; failed: unknown[] };
    expect(body.queued).toBe(3);
    expect(body.failed).toEqual([]);
    expect(pendingRows()).toEqual([
      { vocabId: 'v1', cardType: 'basic' },
      { vocabId: 'v1', cardType: 'cloze' },
      { vocabId: 'v2', cardType: 'word' },
    ]);
  });

  test('re-queuing replaces the pending row instead of duplicating it', async () => {
    seedVocab('v1', 'huis');
    await post('/queue', { items: [{ id: 'v1', cardType: 'basic' }] });
    await post('/queue', { items: [{ id: 'v1', cardType: 'basic', meaning: 'dwelling' }] });

    expect(pendingRows()).toEqual([{ vocabId: 'v1', cardType: 'basic' }]);
    const row = db.prepare('SELECT meaning FROM anki_pending WHERE vocabId = ?').get('v1') as {
      meaning: string;
    };
    expect(row.meaning).toBe('dwelling');
  });

  test('unknown entries and blank-less clozes fail per-item', async () => {
    seedVocab('v1', 'huis', { sentence: 'Iets heeltemal anders.' });

    const res = await post('/queue', {
      items: [
        { id: 'missing', cardType: 'basic' },
        { id: 'v1', cardType: 'cloze' }, // "huis" not in the sentence
      ],
    });
    const body = (await res.json()) as { queued: number; failed: Array<{ id: string }> };
    expect(body.queued).toBe(0);
    expect(body.failed.map((f) => f.id)).toEqual(['missing', 'v1']);
    expect(pendingRows()).toEqual([]);
  });

  test('rejects malformed bodies', async () => {
    expect((await post('/queue', {})).status).toBe(400);
    expect((await post('/queue', { items: [] })).status).toBe(400);
    expect((await post('/queue', { items: 'nope' })).status).toBe(400);
  });
});

describe('GET /api/anki/pending', () => {
  beforeEach(clear);
  afterEach(clear);

  test('serves render-ready fields: bolded sentence, cloze text, meaning fallback', async () => {
    seedVocab('v1', 'huis', { sentence: 'Die huis is groot.', translation: 'The house is big.' });
    await post('/queue', {
      items: [
        { id: 'v1', cardType: 'basic' },
        { id: 'v1', cardType: 'cloze', meaning: 'house' },
      ],
    });

    const res = await app.request('/pending');
    const { pending } = (await res.json()) as {
      pending: Array<{
        lectorId: string;
        cardType: string;
        lang: string;
        word: string;
        sentenceHtml: string;
        clozeText: string;
        translation: string;
        meaning: string;
      }>;
    };

    expect(pending.length).toBe(2);
    const basic = pending.find((p) => p.cardType === 'basic')!;
    expect(basic.lectorId).toBe('v1');
    expect(basic.lang).toBe('af');
    expect(basic.word).toBe('huis');
    expect(basic.sentenceHtml).toBe('Die <b>huis</b> is groot.');
    expect(basic.meaning).toBe('The house is big.'); // falls back to translation

    const cloze = pending.find((p) => p.cardType === 'cloze')!;
    expect(cloze.clozeText).toBe('Die {{c1::huis}} is groot.');
    expect(cloze.meaning).toBe('house');
  });

  test('per-item overrides win over the vocab row (phrase-cloze / practice)', async () => {
    seedVocab('v1', 'baie groot huis', { sentence: 'original', translation: 'orig-t' });
    await post('/queue', {
      items: [
        {
          id: 'v1',
          cardType: 'cloze',
          word: 'groot',
          sentence: 'Die baie groot huis staan.',
          translation: 'override-t',
        },
      ],
    });

    const { pending } = (await (await app.request('/pending')).json()) as {
      pending: Array<{ word: string; clozeText: string; translation: string }>;
    };
    expect(pending[0].word).toBe('groot');
    expect(pending[0].clozeText).toBe('Die baie {{c1::groot}} huis staan.');
    expect(pending[0].translation).toBe('override-t');
  });

  test('drops (and deletes) clozes invalidated after queueing; hides orphans', async () => {
    seedVocab('v1', 'huis');
    seedVocab('v2', 'groot');
    await post('/queue', {
      items: [
        { id: 'v1', cardType: 'cloze' },
        { id: 'v2', cardType: 'basic' },
      ],
    });

    // The entry's sentence changes so the cloze can no longer be built…
    db.prepare('UPDATE vocab SET sentence = ? WHERE id = ?').run('Nou anders.', 'v1');
    // …and the other entry is deleted outright (orphaned pending row).
    db.prepare('DELETE FROM vocab WHERE id = ?').run('v2');

    const { pending } = (await (await app.request('/pending')).json()) as { pending: unknown[] };
    expect(pending).toEqual([]);
    // The invalidated cloze row self-cleans; the orphan is invisible via the JOIN.
    expect(pendingRows()).toEqual([{ vocabId: 'v2', cardType: 'basic' }]);
  });
});

describe('pending pagination + ack versioning (#241 review P1s)', () => {
  beforeEach(clear);
  afterEach(clear);

  test('pending serves at most one ack-able batch; acking drains it; the rest follows', async () => {
    const insertVocab = db.prepare(
      `INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, createdAt, language)
       VALUES (?, ?, 'word', 's', 't', 'new', ?, ?, 'af')`,
    );
    const insertPending = db.prepare(
      `INSERT INTO anki_pending (userId, vocabId, cardType, queuedAt) VALUES ('local', ?, 'word', ?)`,
    );
    db.transaction(() => {
      for (let i = 0; i < 502; i++) {
        insertVocab.run(`v${i}`, `w${i}`, TS, TS);
        insertPending.run(`v${i}`, TS);
      }
    })();

    const first = (await (await app.request('/pending')).json()) as {
      pending: Array<{ lectorId: string; cardType: string; version: number }>;
      remaining: number;
    };
    expect(first.pending.length).toBe(500);
    expect(first.remaining).toBe(2);

    const ackRes = await post('/ack', {
      results: first.pending.map((p, i) => ({
        lectorId: p.lectorId,
        cardType: p.cardType,
        noteId: i + 1,
        version: p.version,
      })),
    });
    expect(ackRes.status).toBe(200);
    expect(((await ackRes.json()) as { acked: number }).acked).toBe(500);

    const second = (await (await app.request('/pending')).json()) as {
      pending: unknown[];
      remaining: number;
    };
    expect(second.pending.length).toBe(2);
    expect(second.remaining).toBe(0);
  });

  test('a stale ack cannot delete a re-queued card (version guard)', async () => {
    seedVocab('v1', 'huis');
    await post('/queue', { items: [{ id: 'v1', cardType: 'basic' }] });

    // The addon pulls version 1…
    const pulled = (await (await app.request('/pending')).json()) as {
      pending: Array<{ version: number }>;
    };
    expect(pulled.pending[0].version).toBe(1);

    // …the user re-queues with new content before the ack lands…
    await post('/queue', { items: [{ id: 'v1', cardType: 'basic', meaning: 'v2 content' }] });

    // …so the stale ack marks the entry pushed (the v1 note DOES exist in
    // Anki) but must NOT clear the newer queue row.
    await post('/ack', {
      results: [
        { lectorId: 'v1', cardType: 'basic', noteId: 1, version: pulled.pending[0].version },
      ],
    });
    expect(vocabRow('v1')!.pushedToAnki).toBe(1);

    const again = (await (await app.request('/pending')).json()) as {
      pending: Array<{ meaning: string; version: number }>;
    };
    expect(again.pending.length).toBe(1);
    expect(again.pending[0].meaning).toBe('v2 content');
    expect(again.pending[0].version).toBe(2);

    // A current-version ack clears it.
    await post('/ack', { results: [{ lectorId: 'v1', cardType: 'basic', noteId: 1, version: 2 }] });
    expect(pendingRows()).toEqual([]);
  });
});

describe('POST /api/anki/ack', () => {
  beforeEach(clear);
  afterEach(clear);

  test('marks entries pushed, stores the note id, clears the queue', async () => {
    seedVocab('v1', 'huis');
    await post('/queue', { items: [{ id: 'v1', cardType: 'basic' }] });

    const res = await post('/ack', {
      results: [{ lectorId: 'v1', cardType: 'basic', noteId: 1234567890 }],
    });
    expect(((await res.json()) as { acked: number }).acked).toBe(1);

    expect(vocabRow('v1')).toEqual({ state: 'new', pushedToAnki: 1, ankiNoteId: 1234567890 });
    expect(pendingRows()).toEqual([]);
  });

  test('rejects acks without a safe numeric note id and ignores unknown entries', async () => {
    seedVocab('v1', 'huis');
    const invalid = await post('/ack', {
      results: [{ lectorId: 'v1', cardType: 'basic' }],
    });
    expect(invalid.status).toBe(400);

    const unknown = await post('/ack', {
      results: [{ lectorId: 'ghost', cardType: 'basic', noteId: 1 }],
    });
    expect(((await unknown.json()) as { acked: number }).acked).toBe(0);
    expect(vocabRow('v1')!.pushedToAnki).toBe(0);
  });
});

describe('POST /api/anki/reviews', () => {
  beforeEach(clear);
  afterEach(clear);

  test('upgrades by lectorId, never demotes, skips ignored and New cards', async () => {
    seedVocab('learning', 'huis', { state: 'level1' });
    seedVocab('mature', 'boom', { state: 'known' });
    seedVocab('muted', 'kat', { state: 'ignored' });
    seedVocab('queued', 'hond', { state: 'level2' });

    const res = await post('/reviews', {
      reviews: [
        { lectorId: 'learning', type: 2, interval: 30 }, // mature card → known
        { lectorId: 'mature', type: 1, interval: 0 }, // learning card → would demote; must not
        { lectorId: 'muted', type: 2, interval: 30 }, // ignored stays ignored
        { lectorId: 'queued', type: 0, interval: 0 }, // New card → no signal
      ],
    });
    const body = (await res.json()) as { updated: number; created: number; unchanged: number };
    expect(body.updated).toBe(1);
    expect(body.created).toBe(0);

    expect(vocabRow('learning')!.state).toBe('known');
    expect(vocabRow('mature')!.state).toBe('known');
    expect(vocabRow('muted')!.state).toBe('ignored');
    expect(vocabRow('queued')!.state).toBe('level2');

    const known = db
      .prepare(
        "SELECT state FROM knownWords WHERE userId = 'local' AND word = ? AND language = 'af'",
      )
      .get('huis') as { state: string };
    expect(known.state).toBe('known');
  });

  test('falls back to folded word matching and keeps the strongest card per target', async () => {
    seedVocab('v1', 'huis', { state: 'new' });

    const res = await post('/reviews', {
      reviews: [
        { word: 'Huis', lang: 'af', type: 1, interval: 0 }, // level1 signal…
        { word: 'huis', lang: 'af', type: 2, interval: 25 }, // …outranked by known
      ],
    });
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(1);
    expect(vocabRow('v1')!.state).toBe('known');
  });

  test('imports studied words that have no entry, marked as pushed', async () => {
    const res = await post('/reviews', {
      reviews: [
        {
          word: 'Berge',
          lang: 'af',
          type: 2,
          interval: 10,
          noteId: 42,
          sentence: 'Die berge is hoog.',
          translation: 'The mountains are high.',
        },
      ],
    });
    const body = (await res.json()) as { updated: number; created: number };
    expect(body.created).toBe(1);

    const row = db
      .prepare(
        "SELECT text, state, sentence, pushedToAnki, ankiNoteId, language FROM vocab WHERE userId = 'local'",
      )
      .get() as {
      text: string;
      state: string;
      sentence: string;
      pushedToAnki: number;
      ankiNoteId: number;
      language: string;
    };
    expect(row.text).toBe('berge'); // folded key, matching the browser sync's import
    expect(row.state).toBe('level4');
    expect(row.sentence).toBe('Die berge is hoog.');
    expect(row.pushedToAnki).toBe(1);
    expect(row.ankiNoteId).toBe(42);
    expect(row.language).toBe('af');
  });

  test('reviewsByDay upserts dailyStats.ankiReviews without clobbering other counters', async () => {
    db.prepare(
      "INSERT INTO dailyStats (userId, date, language, minutesRead, ankiReviews) VALUES ('local', '2026-07-10', 'af', 12, 0)",
    ).run();

    const res = await post('/reviews', {
      reviews: [],
      reviewsByDay: [
        ['2026-07-10', 31],
        ['2026-07-09', 8],
      ],
    });
    const body = (await res.json()) as { syncedDays: number };
    expect(body.syncedDays).toBe(2);

    const day = db
      .prepare(
        "SELECT minutesRead, ankiReviews FROM dailyStats WHERE date = '2026-07-10' AND userId = 'local'",
      )
      .get() as {
      minutesRead: number;
      ankiReviews: number;
    };
    expect(day).toEqual({ minutesRead: 12, ankiReviews: 31 });
  });

  test('rejects malformed review-day metadata instead of silently dropping it', async () => {
    const res = await post('/reviews', {
      reviewsByDay: [['not-a-date', 5]],
    });
    expect(res.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM dailyStats WHERE userId = 'local'").get()).toEqual(
      {
        n: 0,
      },
    );
  });

  test('rejects bodies with neither reviews nor reviewsByDay', async () => {
    expect((await post('/reviews', {})).status).toBe(400);
  });
});

describe('addon protocol handshake', () => {
  // The 426 below-minimum branch is covered in lib/anki-protocol.test.ts
  // (ANKI_PROTOCOL_MIN is 1 today, so no live request can be too old).
  beforeEach(clear);
  afterEach(clear);

  test('addon endpoints advertise the current protocol on every response', async () => {
    const pending = await app.request('/pending');
    expect(pending.status).toBe(200);
    expect(pending.headers.get('x-lector-anki-protocol-current')).toBe('1');

    const ack = await post('/ack', { results: [] });
    expect(ack.status).toBe(400); // body validation still runs under the handshake
    expect(ack.headers.get('x-lector-anki-protocol-current')).toBe('1');
  });

  test('a header-less (pre-handshake 1.0) addon is served normally', async () => {
    const res = await app.request('/pending');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: [], remaining: 0 });
  });

  test('an explicit supported protocol header is served normally', async () => {
    const res = await app.request('/pending', {
      headers: { 'X-Lector-Anki-Protocol': '1' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: [], remaining: 0 });
  });

  test('the browser-facing proxy routes are not protocol-gated', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ result: 6, error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    try {
      const res = await post('/', { action: 'version' });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-lector-anki-protocol-current')).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
