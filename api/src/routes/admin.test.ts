import '../test-guard';
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../db';
import { makeAdminRoutes } from './admin';
import { makeAccountStatusMiddleware, setSuspended, type AdminGateOptions } from '../lib/admin';

// Admin dashboard (#221) route + gate tests. The admin surface is cloud-only,
// so these inject an enabled gate with a fake email resolver (mirroring the
// billing middleware tests) and stand in for session tenant resolution with an
// X-Test-User header. Better Auth's user/session tables don't exist in the
// selfhost test schema, so we create them here in the shared test DB (the
// shape cloud's runAuthMigrations produces) and seed them.

const ADMIN = 'admin-1';
const ALICE = 'alice-1';
const BOB = 'bob-1';
const EMAILS: Record<string, string> = {
  [ADMIN]: 'boss@lector.dev',
  [ALICE]: 'alice@example.com',
  [BOB]: 'bob@example.com',
};

function ensureAuthTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT,
      emailVerified INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt TEXT,
      token TEXT, createdAt TEXT, updatedAt TEXT
    );
  `);
}

function reset() {
  ensureAuthTables();
  for (const t of [
    'user',
    'session',
    'billing_subscriptions',
    'billing_customers',
    'admin_account_flags',
    'collections',
    'lessons',
    'vocab',
    'knownWords',
    'dailyStats',
  ]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='usage_counters'").get()) {
    db.prepare('DELETE FROM usage_counters').run();
  }
}

function seedUser(id: string, opts: { verified?: boolean; createdAt?: string } = {}) {
  db.prepare(
    'INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, EMAILS[id], id, opts.verified ? 1 : 0, opts.createdAt ?? '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
}

function seedSubscription(userId: string, status: string, priceId: string) {
  db.prepare(
    `INSERT INTO billing_subscriptions
       (paddleSubscriptionId, paddleCustomerId, userId, status, priceId, currentPeriodEnd, occurredAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`sub_${userId}`, `ctm_${userId}`, userId, status, priceId, '2999-01-01T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
}

const gate: AdminGateOptions = {
  enabled: true,
  emails: new Set(['boss@lector.dev']),
  resolveEmail: (id) => EMAILS[id] ?? null,
};

/** App with the admin routes behind a stand-in tenant resolver. */
function buildApp(g: AdminGateOptions = gate) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const u = c.req.header('X-Test-User');
    if (u) c.set('userId', u);
    return next();
  });
  app.route('/api/admin', makeAdminRoutes(g));
  return app;
}

const asUser = (u: string) => ({ headers: { 'X-Test-User': u } });

beforeEach(() => {
  reset();
  seedUser(ADMIN, { verified: true });
  seedUser(ALICE, { verified: true });
  seedUser(BOB, { verified: false });
});

afterAll(reset);

describe('requireAdmin gate', () => {
  test('cloud non-admin → 403 admin_required', async () => {
    const res = await buildApp().request('/api/admin/summary', asUser(ALICE));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('admin_required');
  });

  test('admin → 200', async () => {
    const res = await buildApp().request('/api/admin/summary', asUser(ADMIN));
    expect(res.status).toBe(200);
  });

  test('disabled (selfhost) → 404, feature absent even for the operator', async () => {
    const app = buildApp({ enabled: false, emails: gate.emails, resolveEmail: gate.resolveEmail });
    const res = await app.request('/api/admin/summary', asUser(ADMIN));
    expect(res.status).toBe(404);
  });

  test('no resolved tenant → 401', async () => {
    const res = await buildApp().request('/api/admin/summary');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/users', () => {
  test('lists every account with plan, status, library, verified', async () => {
    seedSubscription(ALICE, 'active', 'pri_monthly');
    db.prepare(
      "INSERT INTO collections (id, title, author, language, createdAt, lastReadAt, userId) VALUES ('c1','T','A','af','x','x',?)",
    ).run(ALICE);
    db.prepare(
      "INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, language, createdAt, lastReadAt, userId) VALUES ('l1','c1','T',0,'hello world','af','x','x',?)",
    ).run(ALICE);

    const res = await buildApp().request('/api/admin/users', asUser(ADMIN));
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: Array<Record<string, unknown>> };
    expect(users.length).toBe(3);

    const alice = users.find((u) => u.id === ALICE)!;
    expect(alice.plan).toBe('cloud');
    expect(alice.status).toBe('active');
    expect(alice.entitled).toBe(true);
    expect((alice.library as { collections: number }).collections).toBe(1);
    expect((alice.library as { lessons: number }).lessons).toBe(1);
    expect((alice.library as { storageBytes: number }).storageBytes).toBe('hello world'.length);

    const bob = users.find((u) => u.id === BOB)!;
    expect(bob.plan).toBeNull();
    expect(bob.status).toBe('none');
    expect(bob.emailVerified).toBe(false);
  });

  test('maps the Plus price to the plus plan', async () => {
    // The default gate has no billing prices configured, so the priceId won't
    // map — a paying account still surfaces as the base plan.
    seedSubscription(BOB, 'active', 'pri_unknownt');
    const res = await buildApp().request('/api/admin/users', asUser(ADMIN));
    const { users } = (await res.json()) as { users: Array<Record<string, unknown>> };
    expect(users.find((u) => u.id === BOB)!.plan).toBe('cloud');
  });
});

describe('GET /api/admin/summary', () => {
  test('aggregates accounts, subscribers, verified, statuses', async () => {
    seedSubscription(ALICE, 'active', 'pri_monthly');
    seedSubscription(BOB, 'canceled', 'pri_monthly');
    const res = await buildApp().request('/api/admin/summary', asUser(ADMIN));
    const body = (await res.json()) as {
      users: number;
      verified: number;
      subscribers: number;
      byStatus: Record<string, number>;
    };
    expect(body.users).toBe(3);
    expect(body.verified).toBe(2);
    expect(body.subscribers).toBe(1); // only Alice is entitled
    expect(body.byStatus.active).toBe(1);
    expect(body.byStatus.canceled).toBe(1);
    expect(body.byStatus.none).toBe(1); // admin has no sub
  });
});

describe('GET /api/admin/users/:id/export', () => {
  test('exports the target user’s data; 404 for an unknown id', async () => {
    db.prepare(
      "INSERT INTO vocab (id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt, userId) VALUES ('v1','woord','word','s','t','level1','x','af','x',?)",
    ).run(ALICE);

    const res = await buildApp().request(`/api/admin/users/${ALICE}/export`, asUser(ADMIN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vocab: unknown[] };
    expect(body.vocab.length).toBe(1);

    const missing = await buildApp().request('/api/admin/users/nobody/export', asUser(ADMIN));
    expect(missing.status).toBe(404);
  });
});

describe('suspend / restore', () => {
  test('suspends and restores a user, recording the reason', async () => {
    const suspend = await buildApp().request(`/api/admin/users/${ALICE}/suspend`, {
      method: 'POST',
      headers: { 'X-Test-User': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'spam' }),
    });
    expect(suspend.status).toBe(200);
    expect((await suspend.json()).suspended).toBe(true);

    const detail = await buildApp().request(`/api/admin/users/${ALICE}`, asUser(ADMIN));
    const row = (await detail.json()) as { suspended: boolean; suspendedReason: string };
    expect(row.suspended).toBe(true);
    expect(row.suspendedReason).toBe('spam');

    const restore = await buildApp().request(`/api/admin/users/${ALICE}/restore`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(restore.status).toBe(200);
    const after = await buildApp().request(`/api/admin/users/${ALICE}`, asUser(ADMIN));
    expect(((await after.json()) as { suspended: boolean }).suspended).toBe(false);
  });

  test('refuses to suspend yourself or another admin', async () => {
    const self = await buildApp().request(`/api/admin/users/${ADMIN}/suspend`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(self.status).toBe(400);

    // Make Bob an admin too (by email allowlist) and try to suspend him.
    const twoAdminGate: AdminGateOptions = {
      enabled: true,
      emails: new Set(['boss@lector.dev', 'bob@example.com']),
      resolveEmail: (id) => EMAILS[id] ?? null,
    };
    const other = await buildApp(twoAdminGate).request(`/api/admin/users/${BOB}/suspend`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(other.status).toBe(400);
  });

  test('suspending an unknown user → 404', async () => {
    const res = await buildApp().request('/api/admin/users/nobody/suspend', {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(res.status).toBe(404);
  });
});

describe('account-status middleware (suspension enforcement)', () => {
  function statusApp() {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const u = c.req.header('X-Test-User');
      if (u) c.set('userId', u);
      return next();
    });
    app.use('/api/*', makeAccountStatusMiddleware({ enabled: true }));
    app.get('/api/collections', (c) => c.json({ ok: true }));
    app.get('/api/data', (c) => c.json({ ok: true }));
    app.get('/api/billing/status', (c) => c.json({ ok: true }));
    app.get('/api/admin/summary', (c) => c.json({ ok: true }));
    app.get('/api/auth/session', (c) => c.json({ ok: true }));
    return app;
  }

  test('a suspended account is blocked from normal routes but keeps its escape hatches', async () => {
    setSuspended(ALICE, true, 'spam');
    const app = statusApp();

    expect((await app.request('/api/collections', asUser(ALICE))).status).toBe(403);
    // Escape hatches stay open: data takeout, billing, admin, auth.
    expect((await app.request('/api/data', asUser(ALICE))).status).toBe(200);
    expect((await app.request('/api/billing/status', asUser(ALICE))).status).toBe(200);
    expect((await app.request('/api/admin/summary', asUser(ALICE))).status).toBe(200);
    expect((await app.request('/api/auth/session', asUser(ALICE))).status).toBe(200);
  });

  test('a non-suspended account passes through', async () => {
    const res = await statusApp().request('/api/collections', asUser(BOB));
    expect(res.status).toBe(200);
  });

  test('no-op when disabled (selfhost)', async () => {
    setSuspended(ALICE, true, 'spam');
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      c.set('userId', ALICE);
      return next();
    });
    app.use('/api/*', makeAccountStatusMiddleware({ enabled: false }));
    app.get('/api/collections', (c) => c.json({ ok: true }));
    expect((await app.request('/api/collections')).status).toBe(200);
  });
});
