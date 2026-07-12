import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import type { CacheAcceptedInput } from '../lib/dictionary-db';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';

const {
  default: app,
  MAX_RESTORE_BODY_BYTES,
  MAX_NON_FREE_RESTORE_BODY_BYTES,
  RestoreInFlightLimiter,
} = await import('../routes/data');

const TABLES = [
  'cached_senses',
  'cached_related_forms',
  'cached_entries',
  'collections',
  'collection_groups',
  'lessons',
  'vocab',
  'knownWords',
  'clozeSentences',
  'journal_entries',
  'dailyStats',
  'learner_events',
  'onboarding_progress',
  'learner_profiles',
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

const LIMITED: PlanLimits = {
  ...NO_STORAGE_LIMITS,
  phraseSelectionWords: 6,
  journalWordsPerMonth: 1_000,
  maxCollections: 1,
  maxLessons: 1,
  llmRequestsPerMonth: 0,
  ttsCharsPerMonth: 0,
  wordGlossesPerMonth: 1_000,
  phraseTranslationsPerDay: 10,
  contextTranslationsPerDay: 10,
};

function installLimitedEngine(compedPlan: 'cloud' | 'plus' | null = null) {
  return setEntitlementsEngineForTests(
    makeEntitlements({
      enforced: true,
      freeTierEnabled: true,
      exemptEmails: new Set(),
      prices: [],
      planLimits: { free: LIMITED, cloud: LIMITED, plus: LIMITED },
      resolveEmail: () => null,
      isByok: () => false,
      compedPlan: () => compedPlan,
      now: () => new Date('2026-07-15T12:00:00Z'),
    }),
  );
}

function seedCollection(id: string, title = id) {
  db.prepare(
    `INSERT INTO collections
      (id, title, author, language, createdAt, lastReadAt, userId)
     VALUES (?, ?, 'Unknown', 'af', ?, ?, 'local')`,
  ).run(id, title, TS, TS);
}

function seedLesson(id: string, collectionId: string, title = id) {
  db.prepare(
    `INSERT INTO lessons
      (id, collectionId, title, textContent, wordCount, language, createdAt, lastReadAt, userId)
     VALUES (?, ?, ?, 'old', 1, 'af', ?, ?, 'local')`,
  ).run(id, collectionId, title, TS, TS);
}

describe('data import/restore — language partitioning', () => {
  beforeEach(reset);
  afterEach(reset);

  test('restores language + previously-dropped columns; no cross-language row collapse', async () => {
    const res = await importData({
      collectionGroups: [{ id: 'g1', name: 'Group', sortOrder: 3, createdAt: TS }],
      collections: [
        {
          id: 'c_af',
          title: 'AF',
          language: 'af',
          groupId: 'g1',
          sortOrder: 2,
          createdAt: TS,
          lastReadAt: TS,
        },
        {
          id: 'c_de',
          title: 'DE',
          language: 'de',
          groupId: null,
          sortOrder: 1,
          createdAt: TS,
          lastReadAt: TS,
        },
      ],
      // Same word in two languages must NOT collapse (compound PK word, language).
      knownWords: [
        { word: 'die', language: 'af', state: 'known' },
        { word: 'die', language: 'de', state: 'level2' },
      ],
      // Same date in two languages must NOT collapse; ankiReviews + sessionStartedAt
      // must survive (they were dropped by the old import column list).
      dailyStats: [
        {
          date: '2026-06-20',
          language: 'af',
          minutesRead: 10,
          ankiReviews: 5,
          sessionStartedAt: '2026-06-20T08:00:00Z',
        },
        {
          date: '2026-06-20',
          language: 'de',
          minutesRead: 3,
          ankiReviews: 2,
          sessionStartedAt: '2026-06-20T09:00:00Z',
        },
      ],
      // blacklisted is a value-bearing column that the old import dropped → reset to 0.
      clozeSentences: [
        {
          id: 'cs1',
          sentence: 'Ek lees.',
          clozeWord: 'lees',
          clozeIndex: 1,
          translation: 'I read.',
          source: 'tatoeba',
          collection: 'random',
          nextReview: TS,
          blacklisted: 1,
          language: 'de',
        },
      ],
    });
    expect(res.status).toBe(200);

    // Groups restored, so collections' groupId resolves.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM collection_groups').get() as { n: number }).n,
    ).toBe(1);

    // collections: language + groupId + sortOrder all preserved.
    const cAf = db
      .prepare("SELECT language, groupId, sortOrder FROM collections WHERE id = 'c_af'")
      .get() as {
      language: string;
      groupId: string | null;
      sortOrder: number;
    };
    expect(cAf).toEqual({ language: 'af', groupId: 'g1', sortOrder: 2 });
    expect(
      (
        db.prepare("SELECT language FROM collections WHERE id = 'c_de'").get() as {
          language: string;
        }
      ).language,
    ).toBe('de');

    // knownWords: both languages survive.
    const kw = db
      .prepare("SELECT language, state FROM knownWords WHERE word = 'die' ORDER BY language")
      .all() as { language: string; state: string }[];
    expect(kw).toEqual([
      { language: 'af', state: 'known' },
      { language: 'de', state: 'level2' },
    ]);

    // dailyStats: both languages survive; ankiReviews + sessionStartedAt preserved.
    const ds = db
      .prepare(
        "SELECT language, minutesRead, ankiReviews, sessionStartedAt FROM dailyStats WHERE date = '2026-06-20' ORDER BY language",
      )
      .all() as {
      language: string;
      minutesRead: number;
      ankiReviews: number;
      sessionStartedAt: string;
    }[];
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
    expect(
      (
        db.prepare("SELECT language FROM knownWords WHERE word = 'hond'").get() as {
          language: string;
        }
      ).language,
    ).toBe('af');
    expect(
      (
        db.prepare("SELECT language FROM dailyStats WHERE date = '2026-05-01'").get() as {
          language: string;
        }
      ).language,
    ).toBe('af');
  });

  test('round-trips known-word domains and accepts references created by the same backup', async () => {
    const res = await importData({
      collectionGroups: [{ id: 'g1', name: 'Group' }],
      collections: [{ id: 'c1', title: 'Collection', groupId: 'g1' }],
      lessons: [{ id: 'l1', title: 'Lesson', collectionId: 'c1', textContent: '' }],
      vocab: [{ id: 'v1', text: 'huis', state: 'known', bookId: 'l1' }],
      knownWords: [{ word: 'huis', state: 'known', domain: 'daily_life' }],
      clozeSentences: [
        {
          id: 'z1',
          sentence: 'Die huis.',
          clozeWord: 'huis',
          clozeIndex: 1,
          translation: 'The house.',
          vocabEntryId: 'v1',
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(
      db.prepare("SELECT domain FROM knownWords WHERE userId = 'local' AND word = 'huis'").get(),
    ).toEqual({ domain: 'daily_life' });
    expect(
      db.prepare("SELECT bookId FROM vocab WHERE userId = 'local' AND id = 'v1'").get(),
    ).toEqual({ bookId: 'l1' });

    const exported = (await (await app.request('/')).json()) as {
      knownWords: Array<{ word: string; domain: string | null }>;
    };
    expect(exported.knownWords.find((row) => row.word === 'huis')?.domain).toBe('daily_life');
  });

  test('round-trips a legacy dangling vocab bookId by clearing only the pointer', async () => {
    db.prepare(
      `INSERT INTO vocab
        (id, text, type, sentence, translation, state, stateUpdatedAt, bookId, language, createdAt, userId)
       VALUES ('dangling', 'huis', 'word', '', '', 'new', ?, 'deleted-book', 'af', ?, 'local')`,
    ).run(TS, TS);

    const exported = await (await app.request('/')).json();
    db.prepare("DELETE FROM vocab WHERE id = 'dangling' AND userId = 'local'").run();

    const restored = await importData(exported);
    expect(restored.status).toBe(200);
    expect(
      db.prepare("SELECT bookId FROM vocab WHERE id = 'dangling' AND userId = 'local'").get(),
    ).toEqual({ bookId: null });
  });

  test('rejects invalid domains, cloze indexes, and unowned restore references', async () => {
    expect(
      (
        await importData({
          knownWords: [{ word: 'huis', state: 'known', domain: 'made_up' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await importData({
          clozeSentences: [
            {
              id: 'z1',
              sentence: 'x',
              clozeWord: 'x',
              clozeIndex: 0.5,
              translation: 'x',
            },
          ],
        })
      ).status,
    ).toBe(400);

    for (const payload of [
      { collections: [{ id: 'c1', title: 'x', groupId: 'missing' }] },
      { lessons: [{ id: 'l1', title: 'x', collectionId: 'missing' }] },
      {
        clozeSentences: [
          {
            id: 'z1',
            sentence: 'x',
            clozeWord: 'x',
            clozeIndex: 0,
            translation: 'x',
            vocabEntryId: 'missing',
          },
        ],
      },
    ]) {
      const response = await importData(payload);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('missing') });
    }

    for (const collectionId of [undefined, '']) {
      const response = await importData({
        lessons: [{ id: 'lesson-without-parent', title: 'x', collectionId }],
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('lessons.collectionId'),
      });
    }
  });

  test('export includes language and collection_groups', async () => {
    db.prepare(
      "INSERT INTO knownWords (word, language, state) VALUES ('kat', 'de', 'known')",
    ).run();
    db.prepare(
      "INSERT INTO collection_groups (id, name, sortOrder, createdAt) VALUES ('g9', 'G', 0, ?)",
    ).run(TS);

    const res = await app.request('/');
    const data = (await res.json()) as {
      knownWords: { word: string; language: string }[];
      collectionGroups: { id: string }[];
    };
    expect(data.knownWords.find((w) => w.word === 'kat')?.language).toBe('de');
    expect(data.collectionGroups.map((g) => g.id)).toContain('g9');
  });
});

describe('restore is transactional (#237)', () => {
  beforeEach(reset);
  afterEach(reset);

  test('a malformed row rolls back the whole restore', async () => {
    const res = await importData({
      collections: [{ id: 'c_ok', title: 'Fine', language: 'af', createdAt: TS, lastReadAt: TS }],
      knownWords: [{ word: 'goed', language: 'af', state: 'known' }],
      // sentence is NOT NULL — metadata validation rejects the envelope before
      // the transaction starts, so earlier valid rows cannot land either.
      clozeSentences: [
        { id: 'cs_bad', clozeWord: 'w', clozeIndex: 0, translation: 't', nextReview: TS },
      ],
    });
    expect(res.status).toBe(400);

    // Nothing from the payload survives — including the rows that inserted
    // cleanly before the bad one.
    expect((db.prepare('SELECT COUNT(*) AS n FROM collections').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM knownWords').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM clozeSentences').get() as { n: number }).n).toBe(
      0,
    );
  });

  test('a valid restore still lands in full', async () => {
    const res = await importData({
      collections: [{ id: 'c1', title: 'Book', language: 'af', createdAt: TS, lastReadAt: TS }],
      knownWords: [{ word: 'huis', language: 'af', state: 'known' }],
    });
    expect(res.status).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM collections').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM knownWords').get() as { n: number }).n).toBe(1);
  });

  test('accepted dictionary entries round-trip under the restorer, never a payload userId', async () => {
    const payload = {
      acceptedDictionaryEntries: [
        {
          userId: 'victim-user',
          word: 'zzportable',
          language: 'af',
          senses: [{ partOfSpeech: 'noun', gloss: 'portable meaning' }],
          relatedForms: [{ form: 'zzportability', relation: 'derived from' }],
          sourceSentence: 'private learner sentence',
        },
      ],
    };
    const first = await importData(payload);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      imported: { acceptedDictionaryEntries: number };
    };
    expect(firstBody.imported.acceptedDictionaryEntries).toBe(1);
    expect(
      db
        .prepare(
          'SELECT userId, sourceSentence FROM cached_entries WHERE word = ? AND language = ?',
        )
        .get('zzportable', 'af'),
    ).toEqual({ userId: 'local', sourceSentence: 'private learner sentence' });

    // Re-restoring replaces this tenant's children rather than duplicating or
    // touching a foreign tenant.
    expect((await importData(payload)).status).toBe(200);
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM cached_senses WHERE userId = ? AND word = ?')
        .get('local', 'zzportable'),
    ).toEqual({ n: 1 });

    const exported = (await (await app.request('/')).json()) as {
      acceptedDictionaryEntries: CacheAcceptedInput[];
    };
    expect(exported.acceptedDictionaryEntries).toEqual([
      {
        word: 'zzportable',
        language: 'af',
        senses: [{ partOfSpeech: 'noun', gloss: 'portable meaning' }],
        sourceSentence: 'private learner sentence',
        relatedForms: [{ form: 'zzportability', relation: 'derived from' }],
      },
    ]);
  });

  test('invalid accepted dictionary content rejects before any restore write', async () => {
    const response = await importData({
      collections: [{ id: 'must-not-land', title: 'Nope', createdAt: TS, lastReadAt: TS }],
      acceptedDictionaryEntries: [
        {
          word: 'bad',
          language: 'af',
          senses: [{ partOfSpeech: 'noun', gloss: 'x'.repeat(513) }],
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM cached_entries').get()).toEqual({ n: 0 });
  });
});

describe('restore enforces Free library and request bounds', () => {
  beforeEach(reset);
  afterEach(reset);

  test('rejects net-new collections and lessons at their caps before any restore write', async () => {
    seedCollection('at-cap');
    seedLesson('lesson-at-cap', 'at-cap');
    const restoreEngine = installLimitedEngine();

    try {
      const collectionResponse = await importData({
        collections: [{ id: 'new-collection', title: 'Nope' }],
        knownWords: [{ word: 'must-not-land', state: 'known' }],
      });
      expect(collectionResponse.status).toBe(429);
      expect(await collectionResponse.json()).toMatchObject({
        error: 'plan_limit',
        metric: 'maxCollections',
      });

      const lessonResponse = await importData({
        lessons: [{ id: 'new-lesson', collectionId: 'at-cap', title: 'Nope' }],
        knownWords: [{ word: 'still-must-not-land', state: 'known' }],
      });
      expect(lessonResponse.status).toBe(429);
      expect(await lessonResponse.json()).toMatchObject({
        error: 'plan_limit',
        metric: 'maxLessons',
      });

      expect(
        db.prepare("SELECT COUNT(*) AS n FROM collections WHERE id = 'new-collection'").get(),
      ).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE id = 'new-lesson'").get()).toEqual(
        {
          n: 0,
        },
      );
      expect(db.prepare('SELECT COUNT(*) AS n FROM knownWords').get()).toEqual({ n: 0 });
    } finally {
      restoreEngine();
    }
  });

  test('allows same-id updates for a downgraded account already above its caps', async () => {
    seedCollection('c1');
    seedCollection('c2');
    seedLesson('l1', 'c1');
    seedLesson('l2', 'c2');
    const restoreEngine = installLimitedEngine();

    try {
      const response = await importData({
        collections: [
          { id: 'c1', title: 'Updated 1' },
          { id: 'c2', title: 'Updated 2' },
        ],
        lessons: [
          { id: 'l1', collectionId: 'c1', title: 'Updated L1', textContent: 'new one' },
          { id: 'l2', collectionId: 'c2', title: 'Updated L2', textContent: 'new two' },
        ],
      });
      expect(response.status).toBe(200);
      expect(
        db.prepare('SELECT title FROM collections ORDER BY id').all() as Array<{ title: string }>,
      ).toEqual([{ title: 'Updated 1' }, { title: 'Updated 2' }]);
      expect(
        db.prepare('SELECT title FROM lessons ORDER BY id').all() as Array<{ title: string }>,
      ).toEqual([{ title: 'Updated L1' }, { title: 'Updated L2' }]);
    } finally {
      restoreEngine();
    }
  });

  test('repeated legacy-book restores are idempotent at the Free cap', async () => {
    const restoreEngine = installLimitedEngine();
    const payload = {
      books: [
        {
          id: 'legacy-book',
          title: 'Old backup',
          textContent: 'een twee drie',
          createdAt: TS,
          lastReadAt: TS,
        },
      ],
      vocab: [{ id: 'legacy-word', text: 'huis', state: 'known', bookId: 'legacy-book' }],
    };

    try {
      expect((await importData(payload)).status).toBe(200);
      const firstLesson = db.prepare('SELECT id FROM lessons').get() as { id: string };
      expect((await importData(payload)).status).toBe(200);
      expect(db.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT id FROM lessons').get()).toEqual(firstLesson);
      expect(db.prepare("SELECT bookId FROM vocab WHERE id = 'legacy-word'").get()).toEqual({
        bookId: firstLesson.id,
      });
    } finally {
      restoreEngine();
    }
  });

  test('applies the 90 MiB envelope only to Free restores', async () => {
    const restoreEngine = installLimitedEngine();
    try {
      const oversizedFree = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(MAX_RESTORE_BODY_BYTES + 1),
        },
        body: '{}',
      });
      expect(oversizedFree.status).toBe(413);
      expect(await oversizedFree.json()).toEqual({
        error: 'Backup is too large for this plan (max 90 MiB)',
      });
    } finally {
      restoreEngine();
    }

    const restorePaidEngine = installLimitedEngine('cloud');
    try {
      const sameSizePaid = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(MAX_RESTORE_BODY_BYTES + 1),
        },
        body: '{}',
      });
      expect(sameSizePaid.status).toBe(200);
    } finally {
      restorePaidEngine();
    }

    const sameSizeSelfHosted = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_RESTORE_BODY_BYTES + 1),
      },
      body: '{}',
    });
    expect(sameSizeSelfHosted.status).toBe(200);

    const oversizedUnlimited = await app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_NON_FREE_RESTORE_BODY_BYTES + 1),
      },
      body: '{}',
    });
    expect(oversizedUnlimited.status).toBe(413);
  });

  test('rejects excessive row arrays before looping', async () => {
    const excessiveRows = await importData({ lessons: Array.from({ length: 25_001 }, () => ({})) });
    expect(excessiveRows.status).toBe(400);
    expect(await excessiveRows.json()).toMatchObject({
      error: 'lessons exceeds the restore limit of 25000 rows',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 0 });
  });

  test('admits only one restore process-wide', () => {
    const limiter = new RestoreInFlightLimiter(1);
    const first = limiter.acquire('one');
    const duplicate = limiter.acquire('one');
    const globalOverflow = limiter.acquire('two');

    expect(first.allowed).toBe(true);
    expect(duplicate).toEqual({ allowed: false, reason: 'user' });
    expect(globalOverflow).toEqual({ allowed: false, reason: 'global' });

    if (first.allowed) first.release();
    const afterRelease = limiter.acquire('two');
    expect(afterRelease.allowed).toBe(true);
    if (afterRelease.allowed) afterRelease.release();
  });
});

describe('accepted dictionary export tenancy', () => {
  beforeEach(reset);
  afterEach(reset);

  test('exports only the requested tenant', async () => {
    const now = TS;
    for (const [userId, gloss] of [
      ['local', 'mine'],
      ['other-user', 'theirs'],
    ] as const) {
      db.prepare(
        `INSERT INTO cached_entries
          (userId, word, language, createdAt, updatedAt) VALUES (?, 'zzprivate', 'af', ?, ?)`,
      ).run(userId, now, now);
      db.prepare(
        `INSERT INTO cached_senses
          (userId, word, language, pos, gloss, sort_order) VALUES (?, 'zzprivate', 'af', 'noun', ?, 0)`,
      ).run(userId, gloss);
    }

    const exported = (await (await app.request('/')).json()) as {
      acceptedDictionaryEntries: Array<{ senses: Array<{ gloss: string }> }>;
    };
    expect(exported.acceptedDictionaryEntries).toHaveLength(1);
    expect(exported.acceptedDictionaryEntries[0].senses[0].gloss).toBe('mine');
  });

  test('sanitizes legacy oversized cache metadata into a restore-ready takeout', async () => {
    db.prepare(
      `INSERT INTO cached_entries
        (userId, word, language, sourceSentence, createdAt, updatedAt)
       VALUES ('local', 'zzlegacy', 'af', ?, ?, ?)`,
    ).run('s'.repeat(2_001), TS, TS);
    db.prepare(
      `INSERT INTO cached_senses
        (userId, word, language, pos, gloss, sort_order)
       VALUES ('local', 'zzlegacy', 'af', 'noun', ?, 0)`,
    ).run('g'.repeat(513));

    const exported = (await (await app.request('/')).json()) as {
      acceptedDictionaryEntries: CacheAcceptedInput[];
    };
    expect(exported.acceptedDictionaryEntries).toHaveLength(1);
    expect(exported.acceptedDictionaryEntries[0].senses[0].gloss).toHaveLength(512);
    expect(exported.acceptedDictionaryEntries[0].sourceSentence).toHaveLength(2_000);

    db.prepare('DELETE FROM cached_entries WHERE userId = ?').run('local');
    const restored = await importData(exported);
    expect(restored.status).toBe(200);
    expect(
      db
        .prepare('SELECT sourceSentence FROM cached_entries WHERE userId = ? AND word = ?')
        .get('local', 'zzlegacy'),
    ).toEqual({ sourceSentence: 's'.repeat(2_000) });
  });
});

describe('export/restore — credential redaction (#233)', () => {
  const clearKeys = () =>
    db.prepare("DELETE FROM settings WHERE key IN ('anthropicApiKey', 'timezone')").run();
  beforeEach(clearKeys);
  afterEach(clearKeys);

  test('export replaces sensitive settings values with the sentinel', async () => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'anthropicApiKey', ?)",
    ).run(JSON.stringify('sk-ant-live-secret'));
    db.prepare(
      "INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'timezone', ?)",
    ).run(JSON.stringify('Australia/Sydney'));

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The raw value must not appear anywhere in the export payload.
    expect(raw).not.toContain('sk-ant-live-secret');

    const data = JSON.parse(raw) as { settings: { key: string; value: string }[] };
    expect(data.settings.find((s) => s.key === 'anthropicApiKey')?.value).toBe('__REDACTED__');
    // Non-sensitive settings still round-trip verbatim.
    expect(data.settings.find((s) => s.key === 'timezone')?.value).toBe(
      JSON.stringify('Australia/Sydney'),
    );
  });

  test('restore skips the sentinel instead of clobbering a real stored key', async () => {
    db.prepare(
      "INSERT OR REPLACE INTO settings (userId, key, value) VALUES ('local', 'anthropicApiKey', ?)",
    ).run(JSON.stringify('sk-ant-real'));

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
    const tz = db
      .prepare("SELECT value FROM settings WHERE userId = 'local' AND key = 'timezone'")
      .get() as {
      value: string;
    };
    expect(tz.value).toBe(JSON.stringify('Europe/Berlin'));
  });
});

describe('export/restore — learner profile and onboarding history (#331)', () => {
  beforeEach(reset);
  afterEach(reset);

  test('round-trips multilingual profiles, progress, and idempotency metadata', async () => {
    db.prepare(
      `INSERT INTO learner_profiles
         (userId, language, approximateLevel, interests, dailyMinutes, createdAt, updatedAt)
       VALUES ('local', 'es', 'beginner', '["culture"]', 15, ?, ?),
              ('local', 'de', 'advanced', '["literature"]', 20, ?, ?)`,
    ).run(TS, TS, TS, TS);
    db.prepare(
      `INSERT INTO onboarding_progress
         (userId, status, currentStep, language, startedAt, updatedAt)
       VALUES ('local', 'in_progress', 'practice', 'es', ?, ?)`,
    ).run(TS, TS);
    db.prepare(
      `INSERT INTO learner_events
         (userId, id, eventType, language, properties, idempotencyKey, occurredAt)
       VALUES ('local', 'event-1', 'reader.term_looked_up', 'es', '{"term":"hola"}', 'lookup-1', ?)`,
    ).run(TS);

    const backup = (await (await app.request('/')).json()) as {
      learnerProfiles: unknown[];
      onboardingProgress: unknown[];
      learnerEvents: unknown[];
    };
    expect(backup.learnerProfiles).toHaveLength(2);
    expect(backup.onboardingProgress).toHaveLength(1);
    expect(backup.learnerEvents).toHaveLength(1);

    reset();
    const restored = await importData(backup);
    expect(restored.status).toBe(200);
    expect(
      ((await restored.json()) as { imported: Record<string, number> }).imported,
    ).toMatchObject({
      learnerProfiles: 2,
      onboardingProgress: 1,
      learnerEvents: 1,
    });
    expect(
      db
        .prepare(
          "SELECT approximateLevel FROM learner_profiles WHERE userId = 'local' AND language = 'de'",
        )
        .get(),
    ).toEqual({ approximateLevel: 'advanced' });
    expect(
      db
        .prepare(
          "SELECT idempotencyKey FROM learner_events WHERE userId = 'local' AND id = 'event-1'",
        )
        .get(),
    ).toEqual({ idempotencyKey: 'lookup-1' });
  });
});
