import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  isUnsubscribed,
  listUnsubscribeHeaders,
  recordUnsubscribe,
  signUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from './email-unsubscribe';

afterEach(() => {
  delete process.env.EMAIL_UNSUB_SECRET;
  delete process.env.BETTER_AUTH_SECRET;
});

describe('unsubscribe tokens', () => {
  test('round-trips a signed address', () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('Ada@Example.com');
    expect(token).toBeTruthy();
    expect(verifyUnsubscribeToken(token!)).toBe('ada@example.com');
  });

  test('rejects a tampered token', () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com')!;
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  test('rejects an expired token', () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const token = signUnsubscribeToken('ada@example.com', Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(verifyUnsubscribeToken(token!)).toBeNull();
  });

  test('builds a stop URL on the app origin', () => {
    process.env.EMAIL_UNSUB_SECRET = 'test-secret';
    const url = unsubscribeUrl('https://app.lector.dev/', 'ada@example.com');
    expect(url).toMatch(/^https:\/\/app\.lector\.dev\/api\/email\/unsubscribe\?token=/);
  });
});

describe('email_unsubscribes', () => {
  test('records and reads an opt-out', () => {
    const database = new Database(':memory:');
    database.exec(
      'CREATE TABLE email_unsubscribes (email TEXT PRIMARY KEY, unsubscribedAt TEXT NOT NULL)',
    );
    expect(isUnsubscribed(database, 'ada@example.com')).toBe(false);
    recordUnsubscribe(database, 'Ada@Example.com', '2026-08-25T00:00:00.000Z');
    expect(isUnsubscribed(database, 'ada@example.com')).toBe(true);
  });
});

describe('listUnsubscribeHeaders', () => {
  test('uses angle brackets for the header URL', () => {
    expect(listUnsubscribeHeaders('https://app.lector.dev/api/email/unsubscribe?token=a')).toEqual({
      'List-Unsubscribe': '<https://app.lector.dev/api/email/unsubscribe?token=a>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
