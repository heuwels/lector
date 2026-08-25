/**
 * Signed stop-mail tokens for lifecycle templates (#558).
 * `{{{RESEND_UNSUBSCRIBE_URL}}}` only works on Resend Broadcasts.
 * API template sends must pass our own `STOP_URL`.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Database } from 'bun:sqlite';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PURPOSE = 'lector-email-unsub-v1\n';
const EMAIL_HASH_PREFIX = 'lector-email-unsub:';

function primarySigningKey(): string {
  return process.env.EMAIL_UNSUB_SECRET || process.env.BETTER_AUTH_SECRET || '';
}

function verifyKeys(): string[] {
  const keys: string[] = [];
  const dedicated = process.env.EMAIL_UNSUB_SECRET;
  const session = process.env.BETTER_AUTH_SECRET;
  if (dedicated) keys.push(dedicated);
  if (session && session !== dedicated) keys.push(session);
  return keys;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Stable hash for the suppression list. Survives secret rotation. */
export function unsubscribeEmailKey(email: string): string {
  return createHash('sha256').update(`${EMAIL_HASH_PREFIX}${normalizeEmail(email)}`).digest('hex');
}

function mac(key: string, payload: string, purposePrefixed: boolean): string {
  const body = purposePrefixed ? PURPOSE + payload : payload;
  return createHmac('sha256', key).update(body).digest('base64url');
}

function macMatches(key: string, payload: string, given: string): boolean {
  for (const prefixed of [true, false]) {
    const expected = mac(key, payload, prefixed);
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function signUnsubscribeToken(email: string, now = Date.now()): string | null {
  const key = primarySigningKey();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ e: normalizeEmail(email), exp: now + YEAR_MS }),
  ).toString('base64url');
  return `${payload}.${mac(key, payload, true)}`;
}

export function verifyUnsubscribeToken(token: string, now = Date.now()): string | null {
  const keys = verifyKeys();
  if (keys.length === 0 || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!keys.some((key) => macMatches(key, payload, given))) return null;
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
  const normalized = normalizeEmail(email);
  return Boolean(
    database
      .prepare('SELECT 1 FROM email_unsubscribes WHERE email = ? OR email = ?')
      .get(unsubscribeEmailKey(normalized), normalized),
  );
}

export function recordUnsubscribe(database: Database, email: string, at: string): void {
  database
    .prepare(
      'INSERT OR REPLACE INTO email_unsubscribes (email, unsubscribedAt) VALUES (?, ?)',
    )
    .run(unsubscribeEmailKey(email), at);
}

export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
