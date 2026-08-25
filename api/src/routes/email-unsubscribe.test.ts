import '../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../db';
import { isUnsubscribed, signUnsubscribeToken } from '../lib/email-unsubscribe';
import { makeSessionMiddleware } from '../lib/session';
import { makeAccountStatusMiddleware } from '../lib/admin';
import { makeBillingMiddleware } from '../lib/billing';
import type { AuthEngine } from '../lib/accounts';
import app from './email-unsubscribe';

afterEach(() => {
  delete process.env.EMAIL_UNSUB_SECRET;
  db.prepare('DELETE FROM email_unsubscribes').run();
});

describe('GET /api/email/unsubscribe', () => {
  test('shows a confirm page and does not write', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com');
    const res = await app.request(`/?token=${encodeURIComponent(token!)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Stop product emails?');
    expect(html).toContain('method="post"');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(false);
  });

  test('rejects a bad token', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const res = await app.request('/?token=not-valid');
    expect(res.status).toBe(400);
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(false);
  });
});

describe('POST /api/email/unsubscribe', () => {
  test('accepts a one-click body and returns an empty 200', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com');
    const res = await app.request(`/?token=${encodeURIComponent(token!)}`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(true);
  });

  test('records from a confirm form and returns the done page', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com');
    const res = await app.request('/', {
      method: 'POST',
      body: `token=${encodeURIComponent(token!)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You will not get more product emails');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(true);
  });
});

describe('unsubscribe through the cloud gates', () => {
  function buildGatedApp() {
    const engine = {
      api: { getSession: async () => null },
    } as unknown as AuthEngine;
    const gated = new Hono();
    gated.use('/api/*', makeSessionMiddleware(true, () => engine));
    gated.use(
      '/api/*',
      makeAccountStatusMiddleware({ enabled: true, checkSuspended: () => true }),
    );
    gated.use(
      '/api/*',
      makeBillingMiddleware({
        enforced: true,
        freeTierEnabled: false,
        exemptEmails: new Set(),
        resolveEmail: () => null,
      }),
    );
    gated.route('/api/email/unsubscribe', app);
    gated.get('/api/collections', (c) => c.json({ ok: true }));
    return gated;
  }

  test('GET and POST stay reachable with no session', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com');
    const gated = buildGatedApp();

    expect((await gated.request('/api/collections')).status).toBe(401);

    const get = await gated.request(
      `/api/email/unsubscribe?token=${encodeURIComponent(token!)}`,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('Stop product emails?');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(false);

    const post = await gated.request(
      `/api/email/unsubscribe?token=${encodeURIComponent(token!)}`,
      { method: 'POST', body: 'List-Unsubscribe=One-Click' },
    );
    expect(post.status).toBe(200);
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(true);
  });
});
