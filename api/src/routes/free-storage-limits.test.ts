import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import {
  makeEntitlements,
  NO_STORAGE_LIMITS,
  setEntitlementsEngineForTests,
  type PlanLimits,
} from '../lib/entitlements';
import groups from './groups';
import collections from './collections';
import lessons from './lessons';
import vocab from './vocab';
import knownWords from './known-words';
import cloze from './cloze';
import dictionary from './dictionary';
import journal from './journal';
import anki from './anki';
import data from './data';
import tokens from './tokens';
import settings from './settings';
import stats from './stats';
import learnerEvents from './learner-events';

const STORAGE_LIMITS: PlanLimits = {
  ...NO_STORAGE_LIMITS,
  phraseSelectionWords: 6,
  journalWordsPerMonth: 1_000,
  maxCollections: 10,
  maxLessons: 10,
  maxCollectionGroups: 1,
  maxVocabEntries: 1,
  maxKnownWords: 1,
  maxClozeSentences: 1,
  maxAcceptedDictionaryEntries: 1,
  maxAcceptedDictionaryBytesTotal: 30,
  maxDailyStatsRows: 1,
  maxLearnerEvents: 1,
  maxLearnerEventBytes: 10,
  maxJournalEntries: 2,
  maxApiTokens: 1,
  maxApiTokenNameBytes: 4,
  maxAnkiPendingRows: 1,
  maxAnkiPendingEntryBytes: 10,
  maxAnkiPendingTextBytesTotal: 10,
  maxLessonTextBytes: 12,
  maxLessonTextBytesTotal: 15,
  maxVocabEntryBytes: 12,
  maxVocabTextBytesTotal: 12,
  maxKnownWordBytes: 6,
  maxKnownWordsTextBytesTotal: 6,
  maxClozeEntryBytes: 16,
  maxClozeTextBytesTotal: 16,
  maxGroupNameBytes: 4,
  maxCollectionMetadataBytes: 12,
  maxJournalEntryBytes: 10,
  maxJournalTextBytesTotal: 12,
  maxWriteBatchBytes: 20,
  llmRequestsPerMonth: 0,
  ttsCharsPerMonth: 0,
  wordGlossesPerMonth: 1_000,
  phraseTranslationsPerDay: 10,
  contextTranslationsPerDay: 10,
};

function makeStorageEngine(
  limits: Partial<PlanLimits> = {},
  options: { enforced?: boolean; byok?: boolean } = {},
) {
  const plan = { ...STORAGE_LIMITS, ...limits };
  return makeEntitlements({
    enforced: options.enforced ?? true,
    freeTierEnabled: true,
    exemptEmails: new Set(),
    prices: [],
    planLimits: { free: plan, cloud: plan, plus: plan },
    resolveEmail: () => null,
    isByok: () => options.byok ?? false,
    compedPlan: () => null,
    now: () => new Date('2026-07-15T12:00:00Z'),
  });
}

const TABLES = [
  'cached_senses',
  'cached_related_forms',
  'cached_entries',
  'anki_pending',
  'dailyStats',
  'learner_events',
  'onboarding_progress',
  'learner_profiles',
  'journal_entries',
  'clozeSentences',
  'knownWords',
  'vocab',
  'lessons',
  'collections',
  'collection_groups',
  'usage_counters',
  'api_tokens',
];

function reset() {
  for (const table of TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE userId IN ('local', 'validation-intruder')`).run();
  }
  db.prepare("DELETE FROM settings WHERE userId = 'local' AND key = 'targetLanguage'").run();
  db.prepare("DELETE FROM billing_subscriptions WHERE userId = 'local'").run();
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function expectLimit(response: Response, metric: string) {
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ error: 'plan_limit', metric, plan: 'free' });
}

let restoreEngine: (() => void) | null = null;

beforeEach(() => {
  reset();
  restoreEngine = setEntitlementsEngineForTests(makeStorageEngine());
});

afterEach(() => {
  restoreEngine?.();
  restoreEngine = null;
  reset();
});

describe('Free fair-use storage boundaries', () => {
  test('BYOK never lifts Free storage/product caps', () => {
    restoreEngine?.();
    const engine = makeStorageEngine({}, { byok: true });
    restoreEngine = setEntitlementsEngineForTests(engine);
    const resolved = engine.resolveEntitlements('local');
    expect(resolved).toMatchObject({ plan: 'free', byok: true });
    expect(resolved.limits.maxVocabEntries).toBe(1);
    expect(resolved.limits.maxLessonTextBytesTotal).toBe(15);
    expect(resolved.limits.maxJournalTextBytesTotal).toBe(12);
  });

  test('groups and lesson bodies enforce row, per-item, and aggregate caps', async () => {
    expect((await groups.request('/', json({ name: 'abcd' }))).status).toBe(200);
    await expectLimit(await groups.request('/', json({ name: 'x' })), 'maxCollectionGroups');

    db.prepare("DELETE FROM collection_groups WHERE userId = 'local'").run();
    await expectLimit(await groups.request('/', json({ name: 'abcde' })), 'maxGroupNameBytes');

    const collection = await collections.request('/', json({ title: 'b' }));
    expect(collection.status).toBe(200);
    const collectionId = ((await collection.json()) as { id: string }).id;

    expect(
      (
        await collections.request(
          `/${collectionId}/lessons`,
          json({ title: 't', textContent: '1234567890' }),
        )
      ).status,
    ).toBe(200); // 11 bytes
    expect(
      (
        await collections.request(
          `/${collectionId}/lessons`,
          json({ title: 'u', textContent: '123' }),
        )
      ).status,
    ).toBe(200); // aggregate exactly 15
    await expectLimit(
      await collections.request(`/${collectionId}/lessons`, json({ title: 'v', textContent: '1' })),
      'maxLessonTextBytesTotal',
    );
    await expectLimit(
      await collections.request(
        `/${collectionId}/lessons`,
        json({ title: 'w', textContent: '123456789012' }),
      ),
      'maxLessonTextBytes',
    );

    // A legacy/downgraded row can still shrink even while it remains above
    // both the per-item and aggregate Free byte ceilings.
    db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
    db.prepare(
      `INSERT INTO lessons
        (id, collectionId, title, textContent, language, createdAt, lastReadAt, userId)
       VALUES ('legacy', ?, 't', ?, 'af', 'x', 'x', 'local')`,
    ).run(collectionId, 'x'.repeat(20));
    const shrink = await lessons.request('/legacy?language=af', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textContent: 'x'.repeat(15) }),
    });
    expect(shrink.status).toBe(200);
  });

  test('vocab, known-word bulk writes, and Anki imports share the live caps', async () => {
    expect(
      (await vocab.request('/', json({ id: 'v1', text: 'aa', sentence: 'bbb', translation: 'c' })))
        .status,
    ).toBe(200);
    // Same id/key is an update, not another row, even at both row caps.
    expect(
      (await vocab.request('/', json({ id: 'v1', text: 'aa', sentence: 'b', translation: 'c' })))
        .status,
    ).toBe(200);
    await expectLimit(
      await vocab.request('/', json({ id: 'v2', text: 'bb', sentence: '', translation: '' })),
      'maxVocabEntries',
    );
    await expectLimit(
      await knownWords.request('/', json({ updates: [{ word: 'cc', state: 'known' }] })),
      'maxKnownWords',
    );
    await expectLimit(
      await anki.request(
        '/reviews',
        json({ reviews: [{ word: 'dd', lang: 'af', type: 2, interval: 10 }] }),
      ),
      'maxVocabEntries',
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM vocab WHERE userId = 'local'").get()).toEqual({
      n: 1,
    });
  });

  test('cloze bulk upserts and accepted dictionary cache count only new keys', async () => {
    expect(
      (
        await cloze.request(
          '/',
          json({
            id: 'c1',
            sentence: 'abc',
            clozeWord: 'b',
            clozeIndex: 1,
            translation: 'def',
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await cloze.request(
          '/',
          json([
            {
              id: 'c1',
              sentence: 'ab',
              clozeWord: 'b',
              clozeIndex: 1,
              translation: 'd',
            },
          ]),
        )
      ).status,
    ).toBe(200);
    await expectLimit(
      await cloze.request(
        '/',
        json({
          id: 'c2',
          sentence: 'abc',
          clozeWord: 'b',
          clozeIndex: 1,
          translation: 'def',
        }),
      ),
      'maxClozeSentences',
    );

    const cache = (word: string, gloss: string) =>
      dictionary.request(
        '/cache',
        json({ word, language: 'af', senses: [{ partOfSpeech: 'n', gloss }] }),
      );
    expect((await cache('z', 'g')).status).toBe(200);
    expect((await cache('z', 'gg')).status).toBe(200);
    await expectLimit(await cache('y', 'g'), 'maxAcceptedDictionaryEntries');
  });

  test('journal byte caps stop whitespace-only disk growth and allow legacy shrinking', async () => {
    const first = await journal.request('/', json({ body: ' '.repeat(10) }));
    expect(first.status).toBe(200);
    const id = ((await first.json()) as { id: string }).id;
    await expectLimit(
      await journal.request('/', json({ body: '   ' })),
      'maxJournalTextBytesTotal',
    );

    db.prepare("UPDATE journal_entries SET body = ? WHERE id = ? AND userId = 'local'").run(
      'x'.repeat(20),
      id,
    );
    const shrink = await journal.request(`/${id}?language=af`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(15) }),
    });
    expect(shrink.status).toBe(200);

    restoreEngine?.();
    restoreEngine = setEntitlementsEngineForTests(
      makeStorageEngine({
        maxJournalEntries: 1,
        maxJournalEntryBytes: 100,
        maxJournalTextBytesTotal: 100,
      }),
    );
    await expectLimit(await journal.request('/', json({ body: '' })), 'maxJournalEntries');
  });

  test('settings restore, identity fields, languages, and dates are validated before writes', async () => {
    const unknownSetting = await data.request(
      '/',
      json({
        settings: [{ key: 'attackerBlob', value: 'x' }],
        knownWords: [{ word: 'must-not-land', state: 'known' }],
      }),
    );
    expect(unknownSetting.status).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM knownWords WHERE userId = 'local'").get()).toEqual(
      {
        n: 0,
      },
    );

    for (const payload of [
      { vocab: [{ id: 'x'.repeat(129), text: 'x' }] },
      { knownWords: [{ word: 'x', language: 'xx', state: 'known' }] },
      { dailyStats: [{ date: '2026-99-99', language: 'af' }] },
    ]) {
      expect((await data.request('/', json(payload))).status).toBe(400);
    }

    const tooLargeSetting = await settings.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiModel: 'x'.repeat(64 * 1024 + 1) }),
    });
    expect(tooLargeSetting.status).toBe(400);
  });

  test('daily activity rows and Anki review-day imports share the Free row cap', async () => {
    db.prepare(
      `INSERT INTO dailyStats (userId, date, language, minutesRead)
       VALUES ('local', '2000-01-01', 'af', 1)`,
    ).run();
    await expectLimit(await stats.request('/today?language=af'), 'maxDailyStatsRows');
    await expectLimit(
      await anki.request('/reviews', json({ reviewsByDay: [['2026-01-01', 3]] })),
      'maxDailyStatsRows',
    );
    await expectLimit(
      await data.request(
        '/',
        json({ dailyStats: [{ date: '2026-01-02', language: 'af', minutesRead: 1 }] }),
      ),
      'maxDailyStatsRows',
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM dailyStats WHERE userId = 'local'").get()).toEqual(
      {
        n: 1,
      },
    );
  });

  test('API tokens have a Free row cap and bounded names', async () => {
    expect((await tokens.request('/', json({ name: 'one' }))).status).toBe(201);
    await expectLimit(await tokens.request('/', json({ name: 'two' })), 'maxApiTokens');

    db.prepare("DELETE FROM api_tokens WHERE userId = 'local'").run();
    await expectLimit(await tokens.request('/', json({ name: 'abcde' })), 'maxApiTokenNameBytes');
    expect((await tokens.request('/', json({ name: 'x'.repeat(1025) }))).status).toBe(400);
  });

  test('learner events enforce retained-row and per-event byte caps', async () => {
    const event = (properties: Record<string, unknown>, eventType = 'onboarding.started') =>
      learnerEvents.request('/', json({ eventType, language: 'af', properties }));

    expect((await event({ x: '1' })).status).toBe(201);
    await expectLimit(await event({}, 'onboarding.completed'), 'maxLearnerEvents');

    db.prepare("DELETE FROM learner_events WHERE userId = 'local'").run();
    await expectLimit(await event({ text: '1234567890' }), 'maxLearnerEventBytes');

    const restored = await data.request(
      '/',
      json({
        learnerEvents: [
          {
            id: 'event-1',
            eventType: 'onboarding.started',
            language: 'af',
            properties: {},
          },
          {
            id: 'event-2',
            eventType: 'onboarding.completed',
            language: 'af',
            properties: {},
          },
        ],
      }),
    );
    await expectLimit(restored, 'maxLearnerEvents');
  });

  test('Anki pending overrides are net-key aware and byte bounded', async () => {
    db.prepare(
      `INSERT INTO vocab
        (id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt, userId)
       VALUES ('v1', 'a', 'word', 'a sentence', 't', 'new', 'x', 'af', 'x', 'local')`,
    ).run();
    const queue = (item: Record<string, unknown>) =>
      anki.request('/queue', json({ items: [{ id: 'v1', cardType: 'basic', ...item }] }));

    expect((await queue({ word: 'aa' })).status).toBe(200);
    expect((await queue({ word: 'a' })).status).toBe(200); // same composite key, shrinking
    await expectLimit(
      await anki.request('/queue', json({ items: [{ id: 'v1', cardType: 'word', word: 'b' }] })),
      'maxAnkiPendingRows',
    );

    db.prepare("DELETE FROM anki_pending WHERE userId = 'local'").run();
    await expectLimit(await queue({ meaning: 'x'.repeat(11) }), 'maxAnkiPendingEntryBytes');
  });

  test('interactive client-supplied ids use the restore identity bound', async () => {
    const id = 'x'.repeat(129);
    expect((await vocab.request('/', json({ id, text: 'x' }))).status).toBe(400);
    expect(
      (
        await cloze.request(
          '/',
          json({ id, sentence: 'x', clozeWord: 'x', clozeIndex: 0, translation: 'x' }),
        )
      ).status,
    ).toBe(400);
    expect((await collections.request('/', json({ id, title: 'x' }))).status).toBe(400);
    expect((await collections.request('/', json({ title: 'x', groupId: id }))).status).toBe(400);
    expect((await vocab.request('/', json({ text: 'x', bookId: id }))).status).toBe(400);
    expect(
      (
        await cloze.request(
          '/',
          json({
            sentence: 'x',
            clozeWord: 'x',
            clozeIndex: 0,
            translation: 'x',
            vocabEntryId: id,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await lessons.request('/missing', {
          ...json({ collectionId: id }),
          method: 'PUT',
        })
      ).status,
    ).toBe(400);
    expect(
      (await data.request('/', json({ collections: [{ id: 'c1', title: 'x', groupId: id }] })))
        .status,
    ).toBe(400);
    expect(
      (await data.request('/', json({ vocab: [{ id: 'é'.repeat(65), text: 'x' }] }))).status,
    ).toBe(400);
    expect((await data.request('/', json({ vocab: [{ id: 'bad\nid', text: 'x' }] }))).status).toBe(
      400,
    );
  });

  test('direct metadata writes reject storage-bypass values before SQLite', async () => {
    const timestamp = '2026-01-01T00:00:00Z';
    db.prepare(
      `INSERT INTO collection_groups (userId, id, name, sortOrder, createdAt)
       VALUES ('local', 'g1', 'G', 0, ?)`,
    ).run(timestamp);
    db.prepare(
      `INSERT INTO collections
        (userId, id, title, author, language, createdAt, lastReadAt)
       VALUES ('local', 'c1', 'C', 'A', 'af', ?, ?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO lessons
        (userId, id, collectionId, title, textContent, language, createdAt, lastReadAt)
       VALUES ('local', 'l1', 'c1', 'L', '', 'af', ?, ?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO vocab
        (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
       VALUES ('local', 'v1', 'huis', 'word', '', '', 'new', ?, 'af', ?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO clozeSentences
        (userId, id, sentence, clozeWord, clozeIndex, translation, source, collection,
         nextReview, language)
       VALUES ('local', 'cl1', 'Die huis.', 'huis', 1, 'The house.', 'mined', 'mined', ?, 'af')`,
    ).run(timestamp);

    const put = (app: typeof groups, path: string, body: unknown) =>
      app.request(path, { ...json(body), method: 'PUT' });

    expect((await put(groups, '/g1', { sortOrder: 'x'.repeat(1024) })).status).toBe(400);
    expect((await put(lessons, '/l1?language=af', { sortOrder: 'x'.repeat(1024) })).status).toBe(
      400,
    );
    expect(
      (
        await put(lessons, '/l1/progress?language=af', {
          scrollPosition: 'x'.repeat(1024),
          percentComplete: 50,
        })
      ).status,
    ).toBe(400);
    expect((await put(vocab, '/v1', { reviewCount: 'x'.repeat(1024) })).status).toBe(400);
    expect((await put(cloze, '/cl1?language=af', { nextReview: 'x'.repeat(1024) })).status).toBe(
      400,
    );
    expect(
      (
        await cloze.request('/cl1/review?language=af', {
          ...json({ correct: true, masteryLevel: 25, nextReview: 'not-a-date' }),
        })
      ).status,
    ).toBe(400);
    expect((await journal.request('/', json({ body: '', entryDate: 'tomorrow' }))).status).toBe(
      400,
    );
    expect(
      (
        await stats.request('/today?language=af', {
          ...json({ field: 'points', amount: Number.MAX_SAFE_INTEGER + 1 }),
          method: 'PUT',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await knownWords.request(
          '/',
          json({ updates: [{ word: '\u0000', state: 'known' }], language: 'af' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await anki.request(
          '/ack',
          json({
            results: [{ lectorId: 'v1', cardType: 'word', noteId: Number.MAX_SAFE_INTEGER + 1 }],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await anki.request(
          '/reviews',
          json({ reviewsByDay: [['2026-01-01', Number.MAX_SAFE_INTEGER + 1]] }),
        )
      ).status,
    ).toBe(400);

    expect(
      db
        .prepare("SELECT sortOrder FROM collection_groups WHERE userId = 'local' AND id = 'g1'")
        .get(),
    ).toEqual({ sortOrder: 0 });
    expect(
      db
        .prepare("SELECT nextReview FROM clozeSentences WHERE userId = 'local' AND id = 'cl1'")
        .get(),
    ).toEqual({ nextReview: timestamp });
  });

  test('direct foreign references must belong to the authenticated tenant', async () => {
    const timestamp = '2026-01-01T00:00:00Z';
    db.prepare(
      `INSERT INTO collection_groups (userId, id, name, sortOrder, createdAt)
       VALUES ('validation-intruder', 'g-other', 'Other', 0, ?),
              ('local', 'g-own', 'Own', 0, ?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO collections
        (userId, id, title, author, language, createdAt, lastReadAt)
       VALUES ('validation-intruder', 'c-other', 'Other', 'A', 'af', ?, ?),
              ('local', 'c-own', 'Own', 'A', 'af', ?, ?)`,
    ).run(timestamp, timestamp, timestamp, timestamp);
    db.prepare(
      `INSERT INTO vocab
        (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
       VALUES ('validation-intruder', 'v-other', 'ander', 'word', '', '', 'new', ?, 'af', ?),
              ('local', 'v-own', 'huis', 'word', '', '', 'new', ?, 'af', ?)`,
    ).run(timestamp, timestamp, timestamp, timestamp);
    db.prepare(
      `INSERT INTO lessons
        (userId, id, collectionId, title, textContent, language, createdAt, lastReadAt)
       VALUES ('validation-intruder', 'l-other', 'c-other', 'Other lesson', '', 'af', ?, ?),
              ('local', 'l-own', 'c-own', 'Lesson', '', 'af', ?, ?)`,
    ).run(timestamp, timestamp, timestamp, timestamp);

    expect((await collections.request('/', json({ title: 'No', groupId: 'g-other' }))).status).toBe(
      400,
    );
    expect(
      (await collections.request('/c-other/lessons', json({ title: 'No', textContent: '' })))
        .status,
    ).toBe(404);
    expect(
      (
        await lessons.request('/l-own?language=af', {
          ...json({ collectionId: 'c-other' }),
          method: 'PUT',
        })
      ).status,
    ).toBe(400);
    expect((await vocab.request('/', json({ text: 'nee', bookId: 'l-other' }))).status).toBe(400);
    expect(
      (
        await cloze.request(
          '/',
          json({
            sentence: 'Nee.',
            clozeWord: 'nee',
            clozeIndex: 0,
            translation: 'No.',
            vocabEntryId: 'v-other',
          }),
        )
      ).status,
    ).toBe(400);

    expect((await collections.request('/', json({ title: 'Yes', groupId: 'g-own' }))).status).toBe(
      200,
    );
    expect(
      (await collections.request('/c-own/lessons', json({ title: 'Yes', textContent: '' }))).status,
    ).toBe(200);
    expect(
      (await vocab.request('/', json({ id: 'v-own', text: 'huis', bookId: 'l-own' }))).status,
    ).toBe(200);
    expect(
      (
        await cloze.request(
          '/',
          json({
            sentence: 'Ja.',
            clozeWord: 'ja',
            clozeIndex: 0,
            translation: 'Yes.',
            vocabEntryId: 'v-own',
          }),
        )
      ).status,
    ).toBe(200);
  });

  test('state upserts preserve existing known-word domains', async () => {
    const timestamp = '2026-01-01T00:00:00Z';
    db.prepare(
      `INSERT INTO vocab
        (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
       VALUES ('local', 'v1', 'huis', 'word', '', '', 'new', ?, 'af', ?)`,
    ).run(timestamp, timestamp);
    db.prepare(
      `INSERT INTO knownWords (userId, word, language, state, domain)
       VALUES ('local', 'huis', 'af', 'new', 'daily_life')`,
    ).run();
    const domain = () =>
      (
        db
          .prepare(
            "SELECT domain FROM knownWords WHERE userId = 'local' AND word = 'huis' AND language = 'af'",
          )
          .get() as { domain: string | null }
      ).domain;

    expect(
      (await vocab.request('/', json({ id: 'v1', text: 'huis', state: 'level1' }))).status,
    ).toBe(200);
    expect(domain()).toBe('daily_life');
    expect(
      (
        await knownWords.request(
          '/',
          json({ updates: [{ word: 'huis', state: 'level2' }], language: 'af' }),
        )
      ).status,
    ).toBe(200);
    expect(domain()).toBe('daily_life');
    expect(
      (
        await vocab.request('/v1', {
          ...json({ state: 'level3' }),
          method: 'PUT',
        })
      ).status,
    ).toBe(200);
    expect(domain()).toBe('daily_life');
    expect(
      (
        await anki.request(
          '/reviews',
          json({ reviews: [{ lectorId: 'v1', type: 2, interval: 30 }] }),
        )
      ).status,
    ).toBe(200);
    expect(domain()).toBe('daily_life');
  });

  test('journal entries export and restore correction state under the restorer', async () => {
    restoreEngine?.();
    restoreEngine = setEntitlementsEngineForTests(makeStorageEngine({ maxJournalEntries: 1 }));
    db.prepare(
      `INSERT INTO journal_entries
        (id, body, correctedBody, corrections, status, wordCount, entryDate, language, createdAt, updatedAt, userId)
       VALUES ('j1', 'a', 'b', '[]', 'submitted', 1, '2026-01-01', 'af', ?, ?, 'local')`,
    ).run('2026-01-01T01:00:00Z', '2026-01-01T02:00:00Z');
    const exported = (await (await data.request('/')).json()) as {
      journalEntries: Array<Record<string, unknown>>;
    };
    expect(exported.journalEntries).toHaveLength(1);
    exported.journalEntries[0].userId = 'victim';

    db.prepare("DELETE FROM journal_entries WHERE userId = 'local'").run();
    const restored = await data.request('/', json(exported));
    expect(restored.status).toBe(200);
    expect(
      db
        .prepare(
          `SELECT userId, body, correctedBody, corrections, status, wordCount, entryDate, language
           FROM journal_entries WHERE id = 'j1' AND userId = 'local'`,
        )
        .get(),
    ).toEqual({
      userId: 'local',
      body: 'a',
      correctedBody: 'b',
      corrections: '[]',
      status: 'submitted',
      wordCount: 1,
      entryDate: '2026-01-01',
      language: 'af',
    });
    // Same-id replay works while at the one-row cap.
    expect((await data.request('/', json(exported))).status).toBe(200);
  });

  test('restore is net-new aware and rejects a capped write atomically', async () => {
    const payload = {
      collectionGroups: [{ id: 'g1', name: 'g' }],
      vocab: [{ id: 'v1', text: 'aa', sentence: 'b', translation: 'c', state: 'new' }],
      knownWords: [{ word: 'aa', language: 'af', state: 'new' }],
      clozeSentences: [
        {
          id: 'c1',
          sentence: 'abc',
          clozeWord: 'b',
          clozeIndex: 1,
          translation: 'd',
          nextReview: '2026-01-01T00:00:00Z',
        },
      ],
      acceptedDictionaryEntries: [
        { word: 'z', language: 'af', senses: [{ partOfSpeech: 'n', gloss: 'g' }] },
      ],
    };
    expect((await data.request('/', json(payload))).status).toBe(200);
    // Replaying the same tenant keys updates in place at every row cap.
    expect((await data.request('/', json(payload))).status).toBe(200);

    const denied = await data.request(
      '/',
      json({
        collectionGroups: [{ id: 'g2', name: 'h' }],
        dailyStats: [{ date: '2099-01-01', language: 'af', minutesRead: 1 }],
      }),
    );
    await expectLimit(denied, 'maxCollectionGroups');
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM dailyStats WHERE userId = 'local' AND date = '2099-01-01'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  test('billing-off/self-host remains unlimited', async () => {
    restoreEngine?.();
    restoreEngine = setEntitlementsEngineForTests(
      makeStorageEngine({ maxGroupNameBytes: 1 }, { enforced: false }),
    );
    expect(
      (await groups.request('/', json({ name: 'a very long self-hosted group' }))).status,
    ).toBe(200);
  });
});
