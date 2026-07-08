import '../test-guard';
import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { createHmac } from 'crypto';
import { db } from '../db';
import {
  applyPaddleEvent,
  assertBillingBootable,
  billingConfig,
  isEntitledStatus,
  makeBillingMiddleware,
  parseBillingMode,
  parseExemptEmails,
  parsePaddleEnvironment,
  resolveBillingStatus,
  verifyPaddleSignature,
} from './billing';
import { makeBillingRoutes } from '../routes/billing';
import { makeSessionMiddleware } from './session';
import type { AuthEngine } from './accounts';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = 1_700_000_000;

function resetBillingTables() {
  db.prepare('DELETE FROM billing_subscriptions').run();
  db.prepare('DELETE FROM billing_customers').run();
}

function sign(body: string, ts: number = NOW, secret: string = SECRET): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function subscriptionEvent(overrides: {
  id?: string;
  status?: string;
  customerId?: string;
  occurredAt?: string;
  lectorUserId?: string;
  priceId?: string;
  periodEnd?: string;
}) {
  return {
    event_type: 'subscription.updated',
    occurred_at: overrides.occurredAt ?? '2026-07-08T00:00:00Z',
    data: {
      id: overrides.id ?? 'sub_1',
      status: overrides.status ?? 'active',
      customer_id: overrides.customerId ?? 'ctm_1',
      custom_data: overrides.lectorUserId ? { lectorUserId: overrides.lectorUserId } : null,
      current_billing_period: overrides.periodEnd ? { ends_at: overrides.periodEnd } : null,
      items: [{ price: { id: overrides.priceId ?? 'pri_monthly' } }],
    },
  };
}

function customerEvent(overrides: { id?: string; email?: string; occurredAt?: string }) {
  return {
    event_type: 'customer.created',
    occurred_at: overrides.occurredAt ?? '2026-07-08T00:00:00Z',
    data: {
      id: overrides.id ?? 'ctm_1',
      email: overrides.email ?? 'buyer@example.com',
    },
  };
}

describe('billing env parsing', () => {
  test('LECTOR_BILLING: unset/empty → off, paddle → paddle, junk → throws', () => {
    expect(parseBillingMode(undefined)).toBe('off');
    expect(parseBillingMode('')).toBe('off');
    expect(parseBillingMode('  ')).toBe('off');
    expect(parseBillingMode('paddle')).toBe('paddle');
    expect(() => parseBillingMode('stripe')).toThrow(/Invalid LECTOR_BILLING/);
    expect(() => parseBillingMode('Paddle')).toThrow(/Invalid LECTOR_BILLING/);
  });

  test('PADDLE_ENV: unset → production, sandbox honoured, junk → throws', () => {
    expect(parsePaddleEnvironment(undefined)).toBe('production');
    expect(parsePaddleEnvironment('')).toBe('production');
    expect(parsePaddleEnvironment('production')).toBe('production');
    expect(parsePaddleEnvironment('sandbox')).toBe('sandbox');
    expect(() => parsePaddleEnvironment('staging')).toThrow(/Invalid PADDLE_ENV/);
  });

  test('BILLING_EXEMPT_EMAILS: comma-separated, trimmed, lowercased', () => {
    const set = parseExemptEmails(' Boss@Lector.dev , tester@example.com ,, ');
    expect(set.has('boss@lector.dev')).toBe(true);
    expect(set.has('tester@example.com')).toBe(true);
    expect(set.size).toBe(2);
    expect(parseExemptEmails(undefined).size).toBe(0);
  });

  test('boot guard: paddle needs cloud proper AND a webhook secret', () => {
    expect(() => assertBillingBootable('off', false, false)).not.toThrow();
    expect(() => assertBillingBootable('paddle', true, true)).not.toThrow();
    expect(() => assertBillingBootable('paddle', false, true)).toThrow(/cloud proper/);
    expect(() => assertBillingBootable('paddle', true, false)).toThrow(/PADDLE_WEBHOOK_SECRET/);
  });

  test('billing defaults off in this test env', () => {
    expect(billingConfig.mode).toBe('off');
    expect(billingConfig.enforced).toBe(false);
  });
});

describe('verifyPaddleSignature', () => {
  const body = '{"event_type":"subscription.updated"}';

  test('accepts a valid signature', () => {
    expect(verifyPaddleSignature(body, sign(body), SECRET, NOW)).toBe(true);
  });

  test('rejects a missing or malformed header', () => {
    expect(verifyPaddleSignature(body, undefined, SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, '', SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, 'garbage', SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, 'ts=123', SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, `h1=${'a'.repeat(64)}`, SECRET, NOW)).toBe(false);
  });

  test('rejects a tampered body and a wrong secret', () => {
    expect(verifyPaddleSignature(body + ' ', sign(body), SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, NOW, 'other_secret'), SECRET, NOW)).toBe(false);
  });

  test('rejects timestamps outside the replay window', () => {
    expect(verifyPaddleSignature(body, sign(body, NOW - 61), SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, NOW + 61), SECRET, NOW)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, NOW - 59), SECRET, NOW)).toBe(true);
  });

  test('accepts any matching h1 during secret rotation', () => {
    const good = createHmac('sha256', SECRET).update(`${NOW}:${body}`).digest('hex');
    const stale = 'f'.repeat(64);
    expect(verifyPaddleSignature(body, `ts=${NOW};h1=${stale};h1=${good}`, SECRET, NOW)).toBe(true);
    expect(verifyPaddleSignature(body, `ts=${NOW};h1=${stale},${good}`, SECRET, NOW)).toBe(true);
    expect(verifyPaddleSignature(body, `ts=${NOW};h1=${stale}`, SECRET, NOW)).toBe(false);
  });
});

describe('applyPaddleEvent', () => {
  beforeEach(resetBillingTables);

  test('mirrors customer events, lowercasing the email', () => {
    expect(applyPaddleEvent(customerEvent({ email: 'Buyer@Example.COM' }))).toBe('customer');
    const row = db
      .prepare('SELECT email FROM billing_customers WHERE paddleCustomerId = ?')
      .get('ctm_1') as { email: string };
    expect(row.email).toBe('buyer@example.com');
  });

  test('mirrors subscription events with price, period end, and custom_data tenant', () => {
    expect(
      applyPaddleEvent(
        subscriptionEvent({ lectorUserId: 'u1', priceId: 'pri_x', periodEnd: '2026-08-08T00:00:00Z' }),
      ),
    ).toBe('subscription');
    const row = db
      .prepare('SELECT * FROM billing_subscriptions WHERE paddleSubscriptionId = ?')
      .get('sub_1') as Record<string, string>;
    expect(row.status).toBe('active');
    expect(row.userId).toBe('u1');
    expect(row.priceId).toBe('pri_x');
    expect(row.currentPeriodEnd).toBe('2026-08-08T00:00:00Z');
  });

  test('newer events win; replays and stragglers are stale', () => {
    applyPaddleEvent(subscriptionEvent({ status: 'active', occurredAt: '2026-07-08T00:00:02Z' }));
    // An older cancellation arriving late must not clobber the newer state.
    expect(
      applyPaddleEvent(subscriptionEvent({ status: 'canceled', occurredAt: '2026-07-08T00:00:01Z' })),
    ).toBe('stale');
    // Exact replay of the same event: also stale.
    expect(
      applyPaddleEvent(subscriptionEvent({ status: 'active', occurredAt: '2026-07-08T00:00:02Z' })),
    ).toBe('stale');
    let row = db.prepare('SELECT status FROM billing_subscriptions').get() as { status: string };
    expect(row.status).toBe('active');

    expect(
      applyPaddleEvent(subscriptionEvent({ status: 'canceled', occurredAt: '2026-07-08T00:00:03Z' })),
    ).toBe('subscription');
    row = db.prepare('SELECT status FROM billing_subscriptions').get() as { status: string };
    expect(row.status).toBe('canceled');
  });

  test('an update without custom_data keeps the stored tenant link', () => {
    applyPaddleEvent(subscriptionEvent({ lectorUserId: 'u1', occurredAt: '2026-07-08T00:00:01Z' }));
    applyPaddleEvent(subscriptionEvent({ status: 'past_due', occurredAt: '2026-07-08T00:00:02Z' }));
    const row = db
      .prepare('SELECT userId, status FROM billing_subscriptions')
      .get() as { userId: string; status: string };
    expect(row.userId).toBe('u1');
    expect(row.status).toBe('past_due');
  });

  test('irrelevant and malformed events are ignored, never thrown on', () => {
    expect(applyPaddleEvent({ event_type: 'transaction.completed', occurred_at: 'x', data: {} })).toBe(
      'ignored',
    );
    expect(applyPaddleEvent({})).toBe('ignored');
    expect(applyPaddleEvent({ event_type: 'subscription.updated' })).toBe('ignored');
    expect(
      applyPaddleEvent({ event_type: 'subscription.updated', data: { id: 'sub_x' } }),
    ).toBe('ignored');
    expect(db.prepare('SELECT COUNT(*) AS n FROM billing_subscriptions').get()).toEqual({ n: 0 });
  });
});

describe('resolveBillingStatus + entitlement', () => {
  beforeEach(resetBillingTables);

  test('entitled statuses: active, trialing, past_due; locked: paused, canceled, none, unknown', () => {
    expect(isEntitledStatus('active')).toBe(true);
    expect(isEntitledStatus('trialing')).toBe(true);
    expect(isEntitledStatus('past_due')).toBe(true);
    expect(isEntitledStatus('paused')).toBe(false);
    expect(isEntitledStatus('canceled')).toBe(false);
    expect(isEntitledStatus(null)).toBe(false);
    expect(isEntitledStatus('some_future_status')).toBe(false);
  });

  test('matches by tenant id from custom_data', () => {
    applyPaddleEvent(subscriptionEvent({ lectorUserId: 'u1' }));
    expect(resolveBillingStatus('u1', null)).toBe('active');
    expect(resolveBillingStatus('u2', null)).toBe(null);
  });

  test('matches by customer email, case-insensitively', () => {
    applyPaddleEvent(customerEvent({ id: 'ctm_9', email: 'buyer@example.com' }));
    applyPaddleEvent(subscriptionEvent({ customerId: 'ctm_9' }));
    expect(resolveBillingStatus('whoever', 'Buyer@Example.COM')).toBe('active');
    expect(resolveBillingStatus('whoever', 'other@example.com')).toBe(null);
    expect(resolveBillingStatus('whoever', null)).toBe(null);
  });

  test('the most entitled of several subscriptions wins (canceled + resubscribed)', () => {
    applyPaddleEvent(subscriptionEvent({ id: 'sub_old', status: 'canceled', lectorUserId: 'u1' }));
    applyPaddleEvent(subscriptionEvent({ id: 'sub_new', status: 'active', lectorUserId: 'u1' }));
    expect(resolveBillingStatus('u1', null)).toBe('active');
  });
});

describe('billing middleware', () => {
  beforeEach(resetBillingTables);

  const emails: Record<string, string> = { u1: 'U1@Example.com', boss: 'boss@lector.dev' };

  function buildApp(enforced = true) {
    const app = new Hono();
    // Stand-in for the session middleware's tenant resolution.
    app.use('/api/*', async (c, next) => {
      const user = c.req.header('X-Test-User');
      if (user) c.set('userId', user);
      return next();
    });
    app.use(
      '/api/*',
      makeBillingMiddleware({
        enforced,
        exemptEmails: new Set(['boss@lector.dev']),
        resolveEmail: (id) => emails[id] ?? null,
      }),
    );
    app.get('/api/collections', (c) => c.json({ ok: true }));
    app.post('/api/chat', (c) => c.json({ ok: true }));
    app.get('/api/data', (c) => c.json({ ok: true }));
    app.post('/api/data', (c) => c.json({ ok: true }));
    app.get('/api/auth/session', (c) => c.json({ ok: true }));
    app.get('/api/billing/status', (c) => c.json({ ok: true }));
    app.post('/api/billing/webhook', (c) => c.json({ ok: true }));
    return app;
  }

  const asUser = (user: string) => ({ headers: { 'X-Test-User': user } });

  test('no-op when not enforced', async () => {
    const app = buildApp(false);
    const res = await app.request('/api/collections');
    expect(res.status).toBe(200);
  });

  test('locks an account with no subscription: 402 subscription_required', async () => {
    const app = buildApp();
    const res = await app.request('/api/collections', asUser('u1'));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'subscription_required', status: 'none' });
  });

  test('locks paused and canceled subscriptions, reporting the status', async () => {
    const app = buildApp();
    applyPaddleEvent(subscriptionEvent({ status: 'paused', lectorUserId: 'u1' }));
    const res = await app.request('/api/chat', { method: 'POST', ...asUser('u1') });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'subscription_required', status: 'paused' });
  });

  test('passes an active subscription matched by tenant', async () => {
    const app = buildApp();
    applyPaddleEvent(subscriptionEvent({ lectorUserId: 'u1' }));
    const res = await app.request('/api/collections', asUser('u1'));
    expect(res.status).toBe(200);
  });

  test('passes an active subscription matched by account email', async () => {
    const app = buildApp();
    applyPaddleEvent(customerEvent({ email: 'u1@example.com' }));
    applyPaddleEvent(subscriptionEvent({ customerId: 'ctm_1' }));
    const res = await app.request('/api/collections', asUser('u1'));
    expect(res.status).toBe(200);
  });

  test('past_due (dunning grace) keeps access', async () => {
    const app = buildApp();
    applyPaddleEvent(subscriptionEvent({ status: 'past_due', lectorUserId: 'u1' }));
    const res = await app.request('/api/collections', asUser('u1'));
    expect(res.status).toBe(200);
  });

  test('exempt emails bypass the gate entirely', async () => {
    const app = buildApp();
    const res = await app.request('/api/collections', asUser('boss'));
    expect(res.status).toBe(200);
  });

  test('locked accounts keep data takeout (GET /api/data) but not import', async () => {
    const app = buildApp();
    const exportRes = await app.request('/api/data', asUser('u1'));
    expect(exportRes.status).toBe(200);
    const importRes = await app.request('/api/data', { method: 'POST', ...asUser('u1') });
    expect(importRes.status).toBe(402);
  });

  test('auth and billing endpoints stay reachable for locked accounts', async () => {
    const app = buildApp();
    expect((await app.request('/api/auth/session')).status).toBe(200);
    expect((await app.request('/api/billing/status', asUser('u1'))).status).toBe(200);
    expect((await app.request('/api/billing/webhook', { method: 'POST' })).status).toBe(200);
  });

  test('fails closed on a gated path with no resolved tenant (wiring bug)', async () => {
    const app = buildApp();
    const res = await app.request('/api/collections');
    expect(res.status).toBe(401);
  });
});

describe('billing routes', () => {
  beforeEach(resetBillingTables);

  const enforcedCfg: typeof billingConfig = {
    mode: 'paddle',
    enforced: true,
    webhookSecret: SECRET,
    clientToken: 'live_test_token',
    environment: 'production',
    prices: [{ id: 'pri_monthly', plan: 'cloud', cycle: 'month' }],
    exemptEmails: new Set<string>(),
  };

  function buildApp(cfg: typeof billingConfig, email: string | null = 'local@example.com') {
    const app = new Hono();
    app.route('/api/billing', makeBillingRoutes(cfg, () => email));
    return app;
  }

  function postWebhook(app: Hono, body: string, header?: string) {
    return app.request('/api/billing/webhook', {
      method: 'POST',
      body,
      headers: header ? { 'Paddle-Signature': header } : {},
    });
  }

  test('status reports enforced:false with billing off', async () => {
    const app = buildApp(billingConfig);
    const res = await app.request('/api/billing/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enforced: false, active: true });
  });

  test('status reports a locked account with its checkout config', async () => {
    const app = buildApp(enforcedCfg);
    const res = await app.request('/api/billing/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.enforced).toBe(true);
    expect(body.active).toBe(false);
    expect(body.status).toBe('none');
    expect(body.checkout).toEqual({
      clientToken: 'live_test_token',
      environment: 'production',
      prices: [{ id: 'pri_monthly', plan: 'cloud', cycle: 'month' }],
      email: 'local@example.com',
      // selfhost test config resolves the implicit local tenant
      userId: 'local',
    });
  });

  test('status flips active once a webhook lands for the account email', async () => {
    const app = buildApp(enforcedCfg);
    const evtC = JSON.stringify(customerEvent({ email: 'local@example.com' }));
    const evtS = JSON.stringify(subscriptionEvent({}));
    // Live signatures: default `now` inside the route, so sign with real time.
    const realNow = Math.floor(Date.now() / 1000);
    expect((await postWebhook(app, evtC, sign(evtC, realNow))).status).toBe(200);
    expect((await postWebhook(app, evtS, sign(evtS, realNow))).status).toBe(200);

    const res = await app.request('/api/billing/status');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.active).toBe(true);
    expect(body.status).toBe('active');
  });

  test('status honours exempt emails', async () => {
    const app = buildApp({ ...enforcedCfg, exemptEmails: new Set(['local@example.com']) });
    const res = await app.request('/api/billing/status');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.active).toBe(true);
    expect(body.exempt).toBe(true);
  });

  test('webhook rejects bad signatures and malformed bodies', async () => {
    const app = buildApp(enforcedCfg);
    const evt = JSON.stringify(subscriptionEvent({}));
    const realNow = Math.floor(Date.now() / 1000);

    expect((await postWebhook(app, evt)).status).toBe(401);
    expect((await postWebhook(app, evt, 'ts=1;h1=deadbeef')).status).toBe(401);
    expect((await postWebhook(app, evt, sign(evt, realNow, 'wrong'))).status).toBe(401);
    // Valid signature over junk JSON → 400.
    expect((await postWebhook(app, 'not json', sign('not json', realNow))).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM billing_subscriptions').get()).toEqual({ n: 0 });
  });

  test('webhook 404s when billing is off', async () => {
    const app = buildApp(billingConfig);
    const evt = JSON.stringify(subscriptionEvent({}));
    expect((await postWebhook(app, evt, sign(evt))).status).toBe(404);
  });
});

describe('session middleware carve-out', () => {
  test('the webhook path passes the cloud session gate without a session', async () => {
    const engine = {
      api: { getSession: async () => null },
    } as unknown as AuthEngine;
    const app = new Hono();
    app.use('/api/*', makeSessionMiddleware(true, () => engine));
    app.post('/api/billing/webhook', (c) => c.json({ ok: true }));
    app.get('/api/billing/status', (c) => c.json({ ok: true }));
    app.get('/api/collections', (c) => c.json({ ok: true }));

    // No cookies, no Authorization: only the webhook may pass.
    expect((await app.request('/api/billing/webhook', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/billing/status')).status).toBe(401);
    expect((await app.request('/api/collections')).status).toBe(401);
  });
});
