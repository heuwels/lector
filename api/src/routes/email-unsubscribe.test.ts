import '../test-guard';
import { afterEach, describe, expect, test } from 'bun:test';
import { db } from '../db';
import { isUnsubscribed, signUnsubscribeToken } from '../lib/email-unsubscribe';
import app from './email-unsubscribe';

afterEach(() => {
  delete process.env.EMAIL_UNSUB_SECRET;
  db.prepare('DELETE FROM email_unsubscribes').run();
});

describe('GET /api/email/unsubscribe', () => {
  test('records the address and returns a page', async () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com');
    const res = await app.request(`/?token=${encodeURIComponent(token!)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('You will not get more product emails');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(true);
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
    const res = await app.request(`/?token=${encodeURIComponent(token!)}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(isUnsubscribed(db, 'ada@example.com')).toBe(true);
  });
});
