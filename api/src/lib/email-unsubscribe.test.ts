import { afterEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'crypto';
import { Database } from 'bun:sqlite';
import {
  isUnsubscribed,
  listUnsubscribeHeaders,
  recordUnsubscribe,
  signUnsubscribeToken,
  unsubscribeEmailKey,
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

  test('signs with EMAIL_UNSUB_SECRET when both secrets are set', () => {
    process.env.BETTER_AUTH_SECRET = 'session-secret';
    process.env.EMAIL_UNSUB_SECRET = 'unsub-secret';
    const token = signUnsubscribeToken('ada@example.com');
    delete process.env.BETTER_AUTH_SECRET;
    expect(verifyUnsubscribeToken(token!)).toBe('ada@example.com');
  });

  test('verifies a token signed with BETTER_AUTH_SECRET after EMAIL_UNSUB_SECRET is set', () => {
    process.env.BETTER_AUTH_SECRET = 'session-secret';
    const token = signUnsubscribeToken('ada@example.com');
    process.env.EMAIL_UNSUB_SECRET = 'unsub-secret';
    expect(verifyUnsubscribeToken(token!)).toBe('ada@example.com');
  });

  test('verifies a token after BETTER_AUTH_SECRET rotates when EMAIL_UNSUB_SECRET signed it', () => {
    process.env.EMAIL_UNSUB_SECRET = 'unsub-secret';
    process.env.BETTER_AUTH_SECRET = 'old-session';
    const token = signUnsubscribeToken('ada@example.com');
    process.env.BETTER_AUTH_SECRET = 'new-session';
    expect(verifyUnsubscribeToken(token!)).toBe('ada@example.com');
  });

  test('verifies a legacy token that has no purpose prefix', () => {
    process.env.BETTER_AUTH_SECRET = 'session-secret';
    const payload = Buffer.from(
      JSON.stringify({ e: 'ada@example.com', exp: Date.now() + 60_000 }),
    ).toString('base64url');
    const given = createHmac('sha256', 'session-secret').update(payload).digest('base64url');
    expect(verifyUnsubscribeToken(`${payload}.${given}`)).toBe('ada@example.com');
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
  test('stores a hash and looks it up by address', () => {
    const database = new Database(':memory:');
    database.exec(
      'CREATE TABLE email_unsubscribes (email TEXT PRIMARY KEY, unsubscribedAt TEXT NOT NULL)',
    );
    expect(isUnsubscribed(database, 'ada@example.com')).toBe(false);
    recordUnsubscribe(database, 'Ada@Example.com', '2026-08-25T00:00:00.000Z');
    expect(isUnsubscribed(database, 'ada@example.com')).toBe(true);
    const row = database.prepare('SELECT email FROM email_unsubscribes').get() as { email: string };
    expect(row.email).toBe(unsubscribeEmailKey('ada@example.com'));
    expect(row.email).not.toContain('ada@');
  });

  test('still matches a legacy plaintext row', () => {
    const database = new Database(':memory:');
    database.exec(
      'CREATE TABLE email_unsubscribes (email TEXT PRIMARY KEY, unsubscribedAt TEXT NOT NULL)',
    );
    database
      .prepare('INSERT INTO email_unsubscribes (email, unsubscribedAt) VALUES (?, ?)')
      .run('ada@example.com', '2026-08-25T00:00:00.000Z');
    expect(isUnsubscribed(database, 'Ada@Example.com')).toBe(true);
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
