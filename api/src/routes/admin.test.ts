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
      emailVerified INTEGER DEFAULT 0, twoFactorEnabled INTEGER DEFAULT 0,
      createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt TEXT,
      token TEXT, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS twoFactor (
      id TEXT PRIMARY KEY, secret TEXT, backupCodes TEXT, userId TEXT NOT NULL
    );
  `);
}

function reset() {
  ensureAuthTables();
  for (const t of [
    'user',
    'session',
    'twoFactor',
    'billing_subscriptions',
    'billing_customers',
    'admin_account_flags',
    'admin_audit_log',
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
  ).run(
    id,
    EMAILS[id],
    id,
    opts.verified ? 1 : 0,
    opts.createdAt ?? '2026-06-01T00:00:00Z',
    '2026-06-01T00:00:00Z',
  );
}

function seedSubscription(userId: string, status: string, priceId: string) {
  db.prepare(
    `INSERT INTO billing_subscriptions
       (paddleSubscriptionId, paddleCustomerId, userId, status, priceId, currentPeriodEnd, occurredAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `sub_${userId}`,
    `ctm_${userId}`,
    userId,
    status,
    priceId,
    '2999-01-01T00:00:00Z',
    '2026-07-01T00:00:00Z',
    '2026-07-01T00:00:00Z',
  );
}

const gate: AdminGateOptions = {
  enabled: true,
  emails: new Set(['boss@lector.dev']),
  resolveEmail: (id) => EMAILS[id] ?? null,
};

// Records the auth-engine actions the support endpoints trigger, so tests can
// assert an email was sent without driving Better Auth's real flow.
let authCalls: Array<{ fn: string; email: string }> = [];
const authStub = {
  requestPasswordReset: async (email: string) => {
    authCalls.push({ fn: 'requestPasswordReset', email });
  },
  sendVerificationEmail: async (email: string) => {
    authCalls.push({ fn: 'sendVerificationEmail', email });
  },
};

/** App with the admin routes behind a stand-in tenant resolver. */
function buildApp(g: AdminGateOptions = gate, options: Parameters<typeof makeAdminRoutes>[2] = {}) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const u = c.req.header('X-Test-User');
    if (u) c.set('userId', u);
    return next();
  });
  app.route('/api/admin', makeAdminRoutes(g, authStub, options));
  return app;
}

const asUser = (u: string) => ({ headers: { 'X-Test-User': u } });

beforeEach(() => {
  reset();
  authCalls = [];
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

  test('derives Free rows only when the Free tier is enabled', async () => {
    seedSubscription(ALICE, 'active', 'pri_monthly');
    seedSubscription(BOB, 'canceled', 'pri_monthly');

    const enabled = await buildApp(gate, { freeTierEnabled: true }).request(
      '/api/admin/users',
      asUser(ADMIN),
    );
    const enabledUsers = (await enabled.json()).users as Array<{ id: string; plan: string | null }>;
    expect(enabledUsers.find((u) => u.id === ALICE)!.plan).toBe('cloud');
    expect(enabledUsers.find((u) => u.id === BOB)!.plan).toBe('free');
    expect(enabledUsers.find((u) => u.id === ADMIN)!.plan).toBe('free');

    const disabled = await buildApp(gate, { freeTierEnabled: false }).request(
      '/api/admin/users',
      asUser(ADMIN),
    );
    const disabledUsers = (await disabled.json()).users as Array<{
      id: string;
      plan: string | null;
    }>;
    expect(disabledUsers.find((u) => u.id === BOB)!.plan).toBeNull();
    expect(disabledUsers.find((u) => u.id === ADMIN)!.plan).toBeNull();
  });

  test('does not classify billing-exempt unlimited accounts as Free', async () => {
    const response = await buildApp(gate, {
      freeTierEnabled: true,
      billingExemptEmails: new Set([EMAILS[BOB]]),
    }).request('/api/admin/users', asUser(ADMIN));
    const users = (await response.json()).users as Array<{
      id: string;
      plan: string | null;
    }>;

    expect(users.find((user) => user.id === BOB)!.plan).toBeNull();
    expect(users.find((user) => user.id === ADMIN)!.plan).toBe('free');
  });

  test('reports monthly glosses and current-day phrase/context usage per account', async () => {
    const insert = db.prepare(
      'INSERT INTO usage_counters (userId, metric, period, value, updatedAt) VALUES (?, ?, ?, ?, ?)',
    );
    const updatedAt = '2026-07-11T12:00:00Z';
    insert.run(ALICE, 'wordGlossesPerMonth', '2026-07', 321, updatedAt);
    insert.run(ALICE, 'phraseTranslationsPerDay', '2026-07-11', 7, updatedAt);
    insert.run(ALICE, 'contextTranslationsPerDay', '2026-07-11', 4, updatedAt);
    insert.run(ALICE, 'phraseTranslationsPerDay', '2026-07-10', 99, updatedAt);

    const res = await buildApp(gate, {
      freeTierEnabled: true,
      now: () => new Date('2026-07-11T23:59:00Z'),
    }).request('/api/admin/users', asUser(ADMIN));
    const { users } = (await res.json()) as {
      users: Array<{
        id: string;
        usage: {
          period: string;
          dayPeriod: string;
          wordGlossesPerMonth: number;
          phraseTranslationsPerDay: number;
          contextTranslationsPerDay: number;
        };
      }>;
    };
    const alice = users.find((u) => u.id === ALICE)!;
    expect(alice.usage).toMatchObject({
      period: '2026-07',
      dayPeriod: '2026-07-11',
      wordGlossesPerMonth: 321,
      phraseTranslationsPerDay: 7,
      contextTranslationsPerDay: 4,
    });
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

  test('counts Free separately without changing subscriber semantics and totals its cost drivers', async () => {
    seedSubscription(ALICE, 'active', 'pri_monthly');
    seedSubscription(BOB, 'canceled', 'pri_monthly');
    const insert = db.prepare(
      'INSERT INTO usage_counters (userId, metric, period, value, updatedAt) VALUES (?, ?, ?, ?, ?)',
    );
    const updatedAt = '2026-07-11T12:00:00Z';
    insert.run(ADMIN, 'wordGlossesPerMonth', '2026-07', 10, updatedAt);
    insert.run(BOB, 'wordGlossesPerMonth', '2026-07', 20, updatedAt);
    insert.run(ALICE, 'wordGlossesPerMonth', '2026-07', 5, updatedAt);
    insert.run(BOB, 'phraseTranslationsPerDay', '2026-07-11', 3, updatedAt);
    insert.run(ADMIN, 'contextTranslationsPerDay', '2026-07-11', 2, updatedAt);

    const res = await buildApp(gate, {
      freeTierEnabled: true,
      now: () => new Date('2026-07-11T12:30:00Z'),
    }).request('/api/admin/summary', asUser(ADMIN));
    const body = (await res.json()) as {
      subscribers: number;
      freeAccounts: number;
      byPlan: Record<string, number>;
      period: string;
      dayPeriod: string;
      usageTotals: {
        wordGlossesPerMonth: number;
        phraseTranslationsPerDay: number;
        contextTranslationsPerDay: number;
      };
      freeUsageTotals: {
        wordGlossesPerMonth: number;
        phraseTranslationsPerDay: number;
        contextTranslationsPerDay: number;
      };
    };
    expect(body.subscribers).toBe(1);
    expect(body.freeAccounts).toBe(2);
    expect(body.byPlan).toEqual({ cloud: 1 });
    expect(body.period).toBe('2026-07');
    expect(body.dayPeriod).toBe('2026-07-11');
    expect(body.usageTotals).toMatchObject({
      wordGlossesPerMonth: 35,
      phraseTranslationsPerDay: 3,
      contextTranslationsPerDay: 2,
    });
    expect(body.freeUsageTotals).toEqual({
      wordGlossesPerMonth: 30,
      phraseTranslationsPerDay: 3,
      contextTranslationsPerDay: 2,
    });
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

describe('comp / uncomp (complimentary membership for testers)', () => {
  async function comp(id: string, plan: 'cloud' | 'plus', reason = 'beta tester') {
    return buildApp().request(`/api/admin/users/${id}/comp`, {
      method: 'POST',
      headers: { 'X-Test-User': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, reason }),
    });
  }
  async function fetchRow(id: string) {
    return (await (await buildApp().request(`/api/admin/users/${id}`, asUser(ADMIN))).json()) as {
      compedPlan: 'cloud' | 'plus' | null;
      suspended: boolean;
    };
  }

  test('comps a user to a chosen tier, then un-comps', async () => {
    const res = await comp(ALICE, 'plus');
    expect(res.status).toBe(200);
    expect((await res.json()).compedPlan).toBe('plus');
    expect((await fetchRow(ALICE)).compedPlan).toBe('plus');

    // Re-comp to a different tier overwrites.
    await comp(ALICE, 'cloud');
    expect((await fetchRow(ALICE)).compedPlan).toBe('cloud');

    const uncomp = await buildApp().request(`/api/admin/users/${ALICE}/uncomp`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(uncomp.status).toBe(200);
    expect((await fetchRow(ALICE)).compedPlan).toBeNull();
  });

  test('rejects a bad or missing plan', async () => {
    const bad = await buildApp().request(`/api/admin/users/${ALICE}/comp`, {
      method: 'POST',
      headers: { 'X-Test-User': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'gold' }),
    });
    expect(bad.status).toBe(400);
    const none = await buildApp().request(`/api/admin/users/${ALICE}/comp`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    expect(none.status).toBe(400);
  });

  test('comp and suspend are independent flags on the same row', async () => {
    await comp(ALICE, 'plus');
    await buildApp().request(`/api/admin/users/${ALICE}/suspend`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    let row = await fetchRow(ALICE);
    expect(row.compedPlan).toBe('plus');
    expect(row.suspended).toBe(true);

    // Lifting suspension leaves the comp intact.
    await buildApp().request(`/api/admin/users/${ALICE}/restore`, {
      method: 'POST',
      ...asUser(ADMIN),
    });
    row = await fetchRow(ALICE);
    expect(row.compedPlan).toBe('plus');
    expect(row.suspended).toBe(false);
  });

  test('comping an unknown user → 404', async () => {
    const res = await buildApp().request('/api/admin/users/nobody/comp', {
      method: 'POST',
      headers: { 'X-Test-User': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'cloud' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('auth support actions', () => {
  const post = (path: string) =>
    buildApp().request(`/api/admin/users/${path}`, { method: 'POST', ...asUser(ADMIN) });

  test('reset-mfa clears twoFactorEnabled and the stored secret', async () => {
    db.prepare('UPDATE user SET twoFactorEnabled = 1 WHERE id = ?').run(ALICE);
    db.prepare('INSERT INTO twoFactor (id, secret, backupCodes, userId) VALUES (?, ?, ?, ?)').run(
      'tf1',
      'SECRET',
      'codes',
      ALICE,
    );
    const res = await post(`${ALICE}/reset-mfa`);
    expect(res.status).toBe(200);
    expect(
      (
        db.prepare('SELECT twoFactorEnabled FROM user WHERE id = ?').get(ALICE) as {
          twoFactorEnabled: number;
        }
      ).twoFactorEnabled,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) n FROM twoFactor WHERE userId = ?').get(ALICE) as { n: number })
        .n,
    ).toBe(0);
  });

  test('password-reset triggers the reset email for the account', async () => {
    const res = await post(`${ALICE}/password-reset`);
    expect(res.status).toBe(200);
    expect(authCalls).toEqual([{ fn: 'requestPasswordReset', email: EMAILS[ALICE] }]);
  });

  test('resend-verification sends for an unverified account, 400 for a verified one', async () => {
    const ok = await post(`${BOB}/resend-verification`); // Bob is unverified
    expect(ok.status).toBe(200);
    expect(authCalls).toEqual([{ fn: 'sendVerificationEmail', email: EMAILS[BOB] }]);

    const already = await post(`${ALICE}/resend-verification`); // Alice is verified
    expect(already.status).toBe(400);
  });

  test('force verify flips emailVerified', async () => {
    const res = await post(`${BOB}/verify`);
    expect(res.status).toBe(200);
    expect(
      (
        db.prepare('SELECT emailVerified FROM user WHERE id = ?').get(BOB) as {
          emailVerified: number;
        }
      ).emailVerified,
    ).toBe(1);
  });

  test('revoke-sessions deletes all the account’s sessions and reports the count', async () => {
    const ins = db.prepare('INSERT INTO session (id, userId, token) VALUES (?, ?, ?)');
    ins.run('s1', ALICE, 't1');
    ins.run('s2', ALICE, 't2');
    ins.run('s3', BOB, 't3'); // another user's session is untouched
    const res = await post(`${ALICE}/revoke-sessions`);
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(2);
    expect(
      (db.prepare('SELECT COUNT(*) n FROM session WHERE userId = ?').get(ALICE) as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) n FROM session WHERE userId = ?').get(BOB) as { n: number }).n,
    ).toBe(1);
  });

  test('each action 404s for an unknown user', async () => {
    for (const action of [
      'reset-mfa',
      'password-reset',
      'resend-verification',
      'verify',
      'revoke-sessions',
    ]) {
      expect((await post(`nobody/${action}`)).status).toBe(404);
    }
  });
});

describe('audit log', () => {
  test('records who did what to whom, newest first', async () => {
    await buildApp().request(`/api/admin/users/${ALICE}/suspend`, {
      method: 'POST',
      headers: { 'X-Test-User': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'spam' }),
    });
    await buildApp().request(`/api/admin/users/${ALICE}/reset-mfa`, {
      method: 'POST',
      ...asUser(ADMIN),
    });

    const res = await buildApp().request('/api/admin/audit', asUser(ADMIN));
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as {
      entries: Array<{
        action: string;
        actorEmail: string;
        targetEmail: string;
        detail: string | null;
      }>;
    };
    // Newest first: reset_mfa then suspend.
    expect(entries[0].action).toBe('reset_mfa');
    expect(entries[1].action).toBe('suspend');
    expect(entries[1].detail).toBe('spam');
    expect(entries[0].actorEmail).toBe(EMAILS[ADMIN]);
    expect(entries[0].targetEmail).toBe(EMAILS[ALICE]);
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
