import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../db';
import { makeCommunityRoutes } from './community';
import { makeAdminRoutes } from './admin';
import type { AdminGateOptions } from '../lib/admin';
import {
  makeEntitlements,
  parsePlanLimitOverrides,
  setEntitlementsEngineForTests,
} from '../lib/entitlements';
import communityDefault from './community';

const ALICE = 'alice-community';
const BOB = 'bob-community';
const ADMIN = 'admin-community';
const TS = '2026-08-19T00:00:00Z';

let restoreEngine: (() => void) | null = null;

afterEach(() => {
  restoreEngine?.();
  restoreEngine = null;
});

function usePaidEngine(overrides: Record<string, number | null> = {}) {
  restoreEngine?.();
  const defaults = parsePlanLimitOverrides(undefined);
  restoreEngine = setEntitlementsEngineForTests(
    makeEntitlements({
      enforced: true,
      freeTierEnabled: false,
      exemptEmails: new Set(),
      prices: [],
      planLimits: {
        ...defaults,
        cloud: { ...defaults.cloud, ...overrides },
      },
      resolveEmail: () => null,
      isByok: () => false,
      compedPlan: () => null,
      now: () => new Date('2026-08-19T12:00:00Z'),
    }),
  );
}

function reset() {
  db.prepare('DELETE FROM community_votes').run();
  db.prepare('DELETE FROM community_lessons').run();
  db.prepare('DELETE FROM community_items').run();
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
  db.prepare('DELETE FROM collection_groups').run();
  usePaidEngine();
}

function seedCollection(
  userId: string,
  id: string,
  opts: {
    title?: string;
    language?: string;
    text?: string;
    audio?: boolean;
    youtube?: boolean;
    extraLessons?: number;
  } = {},
) {
  const language = opts.language ?? 'es';
  db.prepare(
    `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
     VALUES (?, ?, 'Ada', ?, ?, ?, ?)`,
  ).run(id, opts.title ?? 'Casa', language, TS, TS, userId);
  db.prepare(
    `INSERT INTO lessons (
       id, collectionId, title, sortOrder, textContent, wordCount, language,
       sourceType, sourceMeta, segments, audioPath, createdAt, lastReadAt, userId
     ) VALUES (?, ?, ?, 0, ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `${id}-l1`,
    id,
    'Uno',
    opts.text ?? 'Hola casa.',
    language,
    opts.youtube ? 'youtube' : null,
    opts.youtube ? '{"videoId":"abc"}' : null,
    opts.youtube ? '[{"start":0,"end":1,"text":"Hola"}]' : null,
    opts.audio ? '/audio/x.mp3' : null,
    TS,
    TS,
    userId,
  );
  for (let i = 0; i < (opts.extraLessons ?? 0); i++) {
    db.prepare(
      `INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, language, createdAt, lastReadAt, userId)
       VALUES (?, ?, ?, ?, 'mas', 1, ?, ?, ?, ?)`,
    ).run(`${id}-lx${i}`, id, `L${i}`, i + 1, language, TS, TS, userId);
  }
}

function communityApp(userId: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.route(
    '/',
    makeCommunityRoutes({
      authRequired: true,
      isAdminUser: (id) => id === ADMIN,
      submitterLabel: (id) => (id === ALICE ? 'Alice' : 'A learner'),
    }),
  );
  return app;
}

function adminApp() {
  const gate: AdminGateOptions = {
    enabled: true,
    emails: new Set(['boss@lector.dev']),
    resolveEmail: (id) => (id === ADMIN ? 'boss@lector.dev' : null),
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', ADMIN);
    return next();
  });
  app.route('/', makeAdminRoutes(gate));
  return app;
}

async function submit(userId: string, collectionId: string, extra: Record<string, unknown> = {}) {
  return communityApp(userId).request('/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, attested: true, ...extra }),
  });
}

async function approve(itemId: string) {
  return adminApp().request(`/community/${itemId}/approve`, { method: 'POST' });
}

beforeEach(reset);

describe('community library (self-host)', () => {
  test('every route returns 404', async () => {
    const res = await communityDefault.request('/items');
    expect(res.status).toBe(404);
  });
});

describe('community library (paid cloud)', () => {
  test('submit copies lesson text and ignores progress', async () => {
    seedCollection(ALICE, 'col-1');
    db.prepare(
      'UPDATE lessons SET progress_percentComplete = 80, progress_scrollPosition = 12 WHERE id = ?',
    ).run('col-1-l1');
    const res = await submit(ALICE, 'col-1');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const lesson = db
      .prepare('SELECT textContent FROM community_lessons WHERE itemId = ?')
      .get(id) as { textContent: string };
    expect(lesson.textContent).toBe('Hola casa.');
    const item = db.prepare('SELECT status FROM community_items WHERE id = ?').get(id) as {
      status: string;
    };
    expect(item.status).toBe('pending');
  });

  test('submit without attestation returns attestation_required', async () => {
    seedCollection(ALICE, 'col-1');
    const res = await communityApp(ALICE).request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionId: 'col-1' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'attestation_required' });
  });

  test('submit refuses starter, audio, empty, and missing collections', async () => {
    seedCollection(ALICE, 'starter-es', { title: 'Starter' });
    expect((await (await submit(ALICE, 'starter-es')).json()) as { error: string }).toEqual({
      error: 'starter_not_allowed',
    });
    seedCollection(ALICE, 'col-audio', { audio: true });
    expect((await (await submit(ALICE, 'col-audio')).json()) as { error: string }).toEqual({
      error: 'audio_not_allowed',
    });
    db.prepare(
      `INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId)
       VALUES ('empty-1', 'Empty', 'Ada', 'es', ?, ?, ?)`,
    ).run(TS, TS, ALICE);
    expect((await (await submit(ALICE, 'empty-1')).json()) as { error: string }).toEqual({
      error: 'empty_collection',
    });
    expect((await (await submit(ALICE, 'nope')).json()) as { error: string }).toEqual({
      error: 'not_found',
    });
  });

  test('submit refuses a fourth pending item', async () => {
    for (let i = 0; i < 4; i++) seedCollection(ALICE, `col-${i}`, { text: `texto ${i}` });
    expect((await submit(ALICE, 'col-0')).status).toBe(201);
    expect((await submit(ALICE, 'col-1')).status).toBe(201);
    expect((await submit(ALICE, 'col-2')).status).toBe(201);
    const fourth = await submit(ALICE, 'col-3');
    expect(fourth.status).toBe(400);
    expect(await fourth.json()).toEqual({ error: 'pending_limit' });
  });

  test('approve then list shows the item; reject hides it', async () => {
    seedCollection(ALICE, 'col-1');
    const created = (await (await submit(ALICE, 'col-1')).json()) as { id: string };
    expect((await communityApp(BOB).request('/items?language=es')).status).toBe(200);
    expect(await (await communityApp(BOB).request('/items?language=es')).json()).toEqual([]);

    expect((await approve(created.id)).status).toBe(200);
    const listed = (await (await communityApp(BOB).request('/items?language=es')).json()) as Array<{
      id: string;
      submitterLabel: string;
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
    expect(listed[0].submitterLabel).toBe('Alice');

    seedCollection(ALICE, 'col-2', { text: 'otro' });
    const second = (await (await submit(ALICE, 'col-2')).json()) as { id: string };
    await adminApp().request(`/community/${second.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'rights' }),
    });
    const after = (await (
      await communityApp(BOB).request('/items?language=es')
    ).json()) as unknown[];
    expect(after).toHaveLength(1);
    const mine = (await (await communityApp(ALICE).request('/mine')).json()) as Array<{
      id: string;
      status: string;
      rejectReason: string | null;
    }>;
    const rejected = mine.find((row) => row.id === second.id);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectReason).toBe('rights');
  });

  test('submit refuses a duplicate published hash', async () => {
    seedCollection(ALICE, 'col-1');
    const created = (await (await submit(ALICE, 'col-1')).json()) as { id: string };
    await approve(created.id);
    seedCollection(BOB, 'col-bob', { text: 'Hola casa.' });
    const dup = await submit(BOB, 'col-bob');
    expect(dup.status).toBe(400);
    expect(await dup.json()).toEqual({ error: 'duplicate' });
  });

  test('vote: one row per user; change and clear update score; submitter cannot vote', async () => {
    seedCollection(ALICE, 'col-1');
    const { id } = (await (await submit(ALICE, 'col-1')).json()) as { id: string };
    await approve(id);

    const own = await communityApp(ALICE).request(`/items/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(own.status).toBe(400);

    const up = await communityApp(BOB).request(`/items/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({ score: 1, viewerVote: 1 });

    const down = await communityApp(BOB).request(`/items/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: -1 }),
    });
    expect(await down.json()).toMatchObject({ score: -1, viewerVote: -1 });

    const clear = await communityApp(BOB).request(`/items/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 0 }),
    });
    expect(await clear.json()).toMatchObject({ score: 0, viewerVote: null });
  });

  test('five net down-votes hide the item; a later up-vote shows it again', async () => {
    seedCollection(ALICE, 'col-1');
    const { id } = (await (await submit(ALICE, 'col-1')).json()) as { id: string };
    await approve(id);
    for (let i = 0; i < 5; i++) {
      const voter = `voter-${i}`;
      await communityApp(voter).request(`/items/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: -1 }),
      });
    }
    expect(await (await communityApp(BOB).request('/items?language=es')).json()).toEqual([]);
    await communityApp('voter-0').request(`/items/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    const listed = (await (
      await communityApp(BOB).request('/items?language=es')
    ).json()) as unknown[];
    expect(listed).toHaveLength(1);
  });

  test('clone writes new ids, group, provenance, and YouTube sourceType', async () => {
    seedCollection(ALICE, 'col-yt', { youtube: true });
    const { id } = (await (await submit(ALICE, 'col-yt')).json()) as { id: string };
    await approve(id);
    const res = await communityApp(BOB).request(`/items/${id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'Community' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cloned: boolean; collectionId: string };
    expect(body.cloned).toBe(true);
    const col = db
      .prepare(
        'SELECT id, groupId, sourceCommunityItemId FROM collections WHERE userId = ? AND id = ?',
      )
      .get(BOB, body.collectionId) as {
      id: string;
      groupId: string;
      sourceCommunityItemId: string;
    };
    expect(col.id).not.toBe('col-yt');
    expect(col.sourceCommunityItemId).toBe(id);
    const group = db
      .prepare('SELECT name FROM collection_groups WHERE id = ? AND userId = ?')
      .get(col.groupId, BOB) as { name: string };
    expect(group.name).toBe('Community');
    const lesson = db
      .prepare('SELECT sourceType, id FROM lessons WHERE userId = ? AND collectionId = ?')
      .get(BOB, body.collectionId) as { sourceType: string; id: string };
    expect(lesson.sourceType).toBe('youtube');
    expect(lesson.id).not.toBe('col-yt-l1');

    const again = await communityApp(BOB).request(`/items/${id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'Other' }),
    });
    expect(await again.json()).toMatchObject({
      cloned: false,
      reason: 'already-cloned',
      collectionId: body.collectionId,
    });
  });

  test('clone at the collection cap returns plan_limit', async () => {
    usePaidEngine({ maxCollections: 0 });
    seedCollection(ALICE, 'col-1');
    const { id } = (await (await submit(ALICE, 'col-1')).json()) as { id: string };
    await approve(id);
    const res = await communityApp(BOB).request(`/items/${id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: 'Community' }),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'plan_limit', metric: 'maxCollections' });
  });
});

describe('community library (cloud accounts, any plan)', () => {
  test('a Free-tier cloud account can submit', async () => {
    restoreEngine?.();
    const defaults = parsePlanLimitOverrides(undefined);
    restoreEngine = setEntitlementsEngineForTests(
      makeEntitlements({
        enforced: true,
        freeTierEnabled: true,
        exemptEmails: new Set(),
        prices: [],
        planLimits: defaults,
        resolveEmail: () => null,
        isByok: () => false,
        compedPlan: () => null,
        now: () => new Date('2026-08-19T12:00:00Z'),
      }),
    );
    seedCollection(ALICE, 'col-1');
    expect((await submit(ALICE, 'col-1')).status).toBe(201);
  });
});
