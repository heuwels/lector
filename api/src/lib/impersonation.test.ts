import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../db';
import type { Context } from 'hono';
import {
  startImpersonation,
  stopImpersonation,
  activeImpersonation,
  makeImpersonationMiddleware,
  IMPERSONATION_TTL_MS,
  type ImpersonationGrant,
} from './impersonation';

// The probe reads c.get('userId') directly — that's the value the middleware
// swaps and that cloud's getCurrentUserId returns. (getCurrentUserId itself
// short-circuits to 'local' under the selfhost test config, so it can't observe
// the swap here.)
const effectiveId = (c: Context) => c.get('userId');

const ADMIN = 'admin-1';
const ALICE = 'alice-1';

beforeEach(() => {
  db.prepare('DELETE FROM admin_impersonation').run();
});

describe('impersonation store', () => {
  test('start writes a grant with a 30-minute expiry; active reads it back', () => {
    const t0 = new Date('2026-07-20T10:00:00Z');
    const grant = startImpersonation(
      ADMIN,
      { userId: ALICE, email: 'alice@example.com' },
      () => t0,
    );
    expect(grant.targetUserId).toBe(ALICE);
    expect(new Date(grant.expiresAt).getTime() - t0.getTime()).toBe(IMPERSONATION_TTL_MS);

    const found = activeImpersonation(ADMIN, () => new Date(t0.getTime() + 60_000));
    expect(found?.targetUserId).toBe(ALICE);
    expect(found?.targetEmail).toBe('alice@example.com');
  });

  test('one active grant per operator — starting again replaces it', () => {
    startImpersonation(ADMIN, { userId: ALICE, email: 'a' });
    startImpersonation(ADMIN, { userId: 'bob-1', email: 'b' });
    const rows = db.prepare('SELECT * FROM admin_impersonation WHERE actorUserId = ?').all(ADMIN);
    expect(rows.length).toBe(1);
    expect((rows[0] as ImpersonationGrant).targetUserId).toBe('bob-1');
  });

  test('a grant past its expiry is inert and lazily deleted', () => {
    const t0 = new Date('2026-07-20T10:00:00Z');
    startImpersonation(ADMIN, { userId: ALICE, email: 'a' }, () => t0);
    const later = () => new Date(t0.getTime() + IMPERSONATION_TTL_MS + 1);
    expect(activeImpersonation(ADMIN, later)).toBeNull();
    // …and swept from the table.
    expect(
      db.prepare('SELECT * FROM admin_impersonation WHERE actorUserId = ?').get(ADMIN),
    ).toBeNull();
  });

  test('stop returns the ended grant + duration, and clears it', () => {
    const t0 = new Date('2026-07-20T10:00:00Z');
    startImpersonation(ADMIN, { userId: ALICE, email: 'a' }, () => t0);
    const ended = stopImpersonation(ADMIN, () => new Date(t0.getTime() + 5 * 60_000));
    expect(ended?.grant.targetUserId).toBe(ALICE);
    expect(ended?.durationMs).toBe(5 * 60_000);
    expect(activeImpersonation(ADMIN)).toBeNull();
    // Stopping again is a no-op.
    expect(stopImpersonation(ADMIN)).toBeNull();
  });
});

describe('impersonation middleware (identity swap)', () => {
  // A tiny app: a stand-in session resolver sets the real userId, then the
  // impersonation middleware runs, then a probe echoes the effective identity.
  function buildApp(grant: ImpersonationGrant | null) {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const u = c.req.header('X-Test-User');
      if (u) c.set('userId', u);
      return next();
    });
    app.use('/api/*', makeImpersonationMiddleware({ enabled: true, lookup: () => grant }));
    const echo = (c: Context) =>
      c.json({ effective: effectiveId(c), impersonator: c.get('impersonatorId') ?? null });
    app.get('/api/collections', echo);
    app.post('/api/collections', echo);
    app.get('/api/admin/summary', echo);
    app.get('/api/auth/session', echo);
    app.post('/api/impersonation/stop', echo);
    return app;
  }

  const grant: ImpersonationGrant = {
    actorUserId: ADMIN,
    targetUserId: ALICE,
    targetEmail: 'alice@example.com',
    startedAt: '2026-07-20T10:00:00Z',
    expiresAt: '2999-01-01T00:00:00Z',
  };
  const asAdmin = { headers: { 'X-Test-User': ADMIN } };

  test('swaps identity to the target on an ordinary GET, preserving the operator id', async () => {
    const res = await buildApp(grant).request('/api/collections', asAdmin);
    expect(await res.json()).toEqual({ effective: ALICE, impersonator: ADMIN });
  });

  test('blocks mutations while impersonating (read-only)', async () => {
    const res = await buildApp(grant).request('/api/collections', { method: 'POST', ...asAdmin });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('impersonation_read_only');
  });

  test('never swaps on the control planes (admin / auth / impersonation)', async () => {
    const app = buildApp(grant);
    expect(await (await app.request('/api/admin/summary', asAdmin)).json()).toEqual({
      effective: ADMIN,
      impersonator: null,
    });
    expect(await (await app.request('/api/auth/session', asAdmin)).json()).toEqual({
      effective: ADMIN,
      impersonator: null,
    });
    // Stop is a POST on a control plane — reachable, not read-only-blocked.
    const stop = await app.request('/api/impersonation/stop', { method: 'POST', ...asAdmin });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ effective: ADMIN, impersonator: null });
  });

  test('no grant → identity untouched', async () => {
    const res = await buildApp(null).request('/api/collections', asAdmin);
    expect(await res.json()).toEqual({ effective: ADMIN, impersonator: null });
  });

  test('disabled (selfhost) → no-op even with a grant', async () => {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      c.set('userId', ADMIN);
      return next();
    });
    app.use('/api/*', makeImpersonationMiddleware({ enabled: false, lookup: () => grant }));
    app.post('/api/collections', (c) => c.json({ effective: effectiveId(c) }));
    const res = await app.request('/api/collections', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).effective).toBe(ADMIN);
  });
});
