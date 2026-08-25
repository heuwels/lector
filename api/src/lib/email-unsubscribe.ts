/**
 * Signed stop-mail tokens for lifecycle templates (#558).
 * `{{{RESEND_UNSUBSCRIBE_URL}}}` only works on Resend Broadcasts.
 * API template sends must pass our own `STOP_URL`.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { Database } from 'bun:sqlite';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function signingKey(): string {
  return process.env.BETTER_AUTH_SECRET || process.env.EMAIL_UNSUB_SECRET || '';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signUnsubscribeToken(email: string, now = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ e: normalizeEmail(email), exp: now + YEAR_MS }),
  ).toString('base64url');
  const mac = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyUnsubscribeToken(token: string, now = Date.now()): string | null {
  const key = signingKey();
  if (!key || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', key).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      e?: unknown;
      exp?: unknown;
    };
    if (typeof data.e !== 'string' || typeof data.exp !== 'number') return null;
    if (now > data.exp) return null;
    return normalizeEmail(data.e);
  } catch {
    return null;
  }
}

export function unsubscribeUrl(appUrl: string, email: string): string | null {
  const token = signUnsubscribeToken(email);
  if (!token) return null;
  const base = appUrl.replace(/\/$/, '');
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function isUnsubscribed(database: Database, email: string): boolean {
  return Boolean(
    database
      .prepare('SELECT 1 FROM email_unsubscribes WHERE email = ?')
      .get(normalizeEmail(email)),
  );
}

export function recordUnsubscribe(database: Database, email: string, at: string): void {
  database
    .prepare(
      'INSERT OR REPLACE INTO email_unsubscribes (email, unsubscribedAt) VALUES (?, ?)',
    )
    .run(normalizeEmail(email), at);
}

export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
