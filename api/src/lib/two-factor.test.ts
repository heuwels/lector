/**
 * TOTP two-factor auth, exercised over HTTP against the same composed app
 * shape accounts.test.ts pins (engine + session middleware + auth handler).
 * Codes are generated from the enrolment URI with a plain RFC-6238
 * implementation — the same math Google Authenticator runs from the QR —
 * so the suite proves interop rather than round-tripping better-auth's own
 * helper. Covers the whole lifecycle: enable is inert until the first code
 * verifies (verify-to-arm), sign-in becomes challenge + code, backup codes
 * are single-use, trusted devices skip the challenge, disable restores
 * plain password sign-in.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Database } from 'bun:sqlite';
import { createHmac } from 'crypto';
import { createAuthEngine, runAuthMigrations, type AuthEngine } from './accounts';
import { makeSessionMiddleware } from './session';
import { resolveUserId } from './user';
import { setEmailTransport, type EmailMessage } from './email';

const BASE = 'http://localhost:9999';
const EMAIL = 'careful@example.com';
const PASSWORD = 'correct-horse-battery';

const emails: EmailMessage[] = [];
let engine: AuthEngine;
let app: Hono;

/** RFC 4648 base32 → bytes, as an authenticator app decodes the QR secret. */
function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of encoded.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(ch);
    if (index === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP from an otpauth:// URI (HMAC-SHA1, like the plugin). */
function totpFromUri(totpURI: string, at: number = Date.now()): string {
  const url = new URL(totpURI);
  const secret = url.searchParams.get('secret');
  if (!secret) throw new Error(`no secret in URI: ${totpURI}`);
  const digits = Number(url.searchParams.get('digits') ?? '6');
  const period = Number(url.searchParams.get('period') ?? '30');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / period)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

/** Collapse Set-Cookie headers into a Cookie header for follow-up requests. */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

async function post(path: string, body: unknown, cookie = ''): Promise<Response> {
  return app.request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function signIn(): Promise<Response> {
  return post('/api/auth/sign-in/email', { email: EMAIL, password: PASSWORD });
}

async function sessionUser(cookie: string): Promise<{ twoFactorEnabled?: boolean } | null> {
  const res = await app.request(`${BASE}/api/auth/get-session`, { headers: { Cookie: cookie } });
  const body = (await res.json()) as { user?: { twoFactorEnabled?: boolean } } | null;
  return body?.user ?? null;
}

beforeAll(async () => {
  setEmailTransport(async (m) => {
    emails.push(m);
  });

  engine = createAuthEngine({
    database: new Database(':memory:'),
    baseURL: BASE,
    secret: 'test-secret-000000000000000000000000',
    trustedOrigins: [BASE],
  });
  await runAuthMigrations(engine);

  app = new Hono();
  app.use('/api/*', makeSessionMiddleware(true, () => engine));
  app.on(['POST', 'GET'], '/api/auth/*', (c) => engine.handler(c.req.raw));
  app.get('/api/whoami', (c) => c.json({ userId: resolveUserId(true, c) }));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  // One verified account for the whole serial lifecycle below.
  await post('/api/auth/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Careful',
  });
  const verifyUrl = [...emails]
    .reverse()
    .find((e) => /verify/i.test(e.subject))!
    .text.match(/https?:\/\/\S+/)![0];
  await app.request(verifyUrl);
});

describe('TOTP enrolment (verify-to-arm)', () => {
  let totpURI: string;
  let backupCodes: string[];

  test('enable without a session is refused', async () => {
    const res = await post('/api/auth/two-factor/enable', { password: PASSWORD });
    expect(res.status).toBe(401);
  });

  test('enable hands back an otpauth URI + backup codes but does not arm 2FA yet', async () => {
    const signin = await signIn();
    const cookie = cookiesFrom(signin);
    const res = await post('/api/auth/two-factor/enable', { password: PASSWORD }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totpURI: string; backupCodes: string[] };
    totpURI = body.totpURI;
    backupCodes = body.backupCodes;

    // The URI is what the QR encodes: our issuer, the account, a base32 secret.
    expect(totpURI).toStartWith('otpauth://totp/');
    expect(totpURI).toContain('issuer=Lector');
    expect(new URL(totpURI).searchParams.get('secret')).toBeTruthy();
    expect(backupCodes.length).toBeGreaterThan(0);

    // Not armed: the account still signs in with the password alone, and the
    // session reports 2FA off — abandoning enrolment can't lock anyone out.
    expect((await sessionUser(cookie))?.twoFactorEnabled).toBeFalsy();
    const plain = await signIn();
    expect(((await plain.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
  });

  test('a wrong code does not arm it either', async () => {
    const cookie = cookiesFrom(await signIn());
    const res = await post('/api/auth/two-factor/verify-totp', { code: '000000' }, cookie);
    expect(res.status).toBe(401);
    expect((await sessionUser(cookie))?.twoFactorEnabled).toBeFalsy();
  });

  test('verifying the current code arms 2FA and rotates the session', async () => {
    const cookie = cookiesFrom(await signIn());
    const res = await post('/api/auth/two-factor/verify-totp', { code: totpFromUri(totpURI) }, cookie);
    expect(res.status).toBe(200);

    // Session-fixation hygiene: the pre-verification session is revoked and
    // the response carries its replacement — the browser swaps cookies
    // transparently.
    const fresh = cookiesFrom(res);
    expect(fresh).toContain('session_token');
    expect(await sessionUser(cookie)).toBeNull();
    expect((await sessionUser(fresh))?.twoFactorEnabled).toBe(true);
  });

  test('sign-in now answers with a 2FA challenge instead of a session', async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
    expect(body.twoFactorRedirect).toBe(true);
    expect(body.twoFactorMethods).toContain('totp');
    const cookies = cookiesFrom(res);
    expect(cookies).toContain('two_factor');
    expect(cookies).not.toContain('session_token');
  });

  test('the challenge + a valid code turns into a session that reaches the API', async () => {
    const challenge = cookiesFrom(await signIn());
    const res = await post(
      '/api/auth/two-factor/verify-totp',
      { code: totpFromUri(totpURI) },
      challenge,
    );
    expect(res.status).toBe(200);
    const session = cookiesFrom(res);
    expect(session).toContain('session_token');

    const who = await app.request(`${BASE}/api/whoami`, { headers: { Cookie: session } });
    expect(who.status).toBe(200);
  });

  test('a wrong code at the challenge is refused', async () => {
    const challenge = cookiesFrom(await signIn());
    const res = await post('/api/auth/two-factor/verify-totp', { code: '000000' }, challenge);
    expect(res.status).toBe(401);
  });

  test('a code without any challenge cookie is refused', async () => {
    const res = await post('/api/auth/two-factor/verify-totp', { code: totpFromUri(totpURI) });
    expect(res.status).toBe(401);
  });

  test('a backup code passes the challenge exactly once', async () => {
    const code = backupCodes[0];
    const first = await post(
      '/api/auth/two-factor/verify-backup-code',
      { code },
      cookiesFrom(await signIn()),
    );
    expect(first.status).toBe(200);
    expect(cookiesFrom(first)).toContain('session_token');

    const again = await post(
      '/api/auth/two-factor/verify-backup-code',
      { code },
      cookiesFrom(await signIn()),
    );
    expect(again.status).toBe(401);
  });

  test('trustDevice at the challenge lets the next sign-in skip 2FA', async () => {
    const challenge = cookiesFrom(await signIn());
    const verified = await post(
      '/api/auth/two-factor/verify-totp',
      { code: totpFromUri(totpURI), trustDevice: true },
      challenge,
    );
    expect(verified.status).toBe(200);
    const trusted = cookiesFrom(verified);
    expect(trusted).toContain('trust_device');

    // Same device (trust cookie rides along) → straight to a session.
    const res = await post('/api/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, trusted);
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBeUndefined();
    expect(cookiesFrom(res)).toContain('session_token');
  });

  test('disable needs the password, then plain password sign-in is back', async () => {
    const challenge = cookiesFrom(await signIn());
    const session = cookiesFrom(
      await post('/api/auth/two-factor/verify-totp', { code: totpFromUri(totpURI) }, challenge),
    );

    const wrong = await post('/api/auth/two-factor/disable', { password: 'not-the-password' }, session);
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const res = await post('/api/auth/two-factor/disable', { password: PASSWORD }, session);
    expect(res.status).toBe(200);
    expect((await sessionUser(session))?.twoFactorEnabled).toBeFalsy();

    const plain = await signIn();
    expect(cookiesFrom(plain)).toContain('session_token');
  });
});
