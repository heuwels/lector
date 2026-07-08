/**
 * Accounts & sessions (#218), exercised over HTTP against a composed app —
 * the same engine factory, session middleware, and identity seam cloud runs,
 * on an in-memory DB. No lector.db involvement: row-level tenancy is the
 * user-scoping ratchet's job (routes/user-scoping.test.ts); this suite pins
 * the credential layer that feeds it a userId.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Database } from 'bun:sqlite';
import { createAuthEngine, runAuthMigrations, type AuthEngine } from './accounts';
import { makeSessionMiddleware } from './session';
import { resolveUserId, LOCAL_USER_ID } from './user';
import { setEmailTransport, type EmailMessage } from './email';

const BASE = 'http://localhost:9999';

const emails: EmailMessage[] = [];
let engine: AuthEngine;
let app: Hono;

function lastEmailMatching(subject: RegExp): EmailMessage {
  const found = [...emails].reverse().find((e) => subject.test(e.subject));
  if (!found) throw new Error(`no captured email matching ${subject}`);
  return found;
}

function extractUrl(email: EmailMessage): string {
  const match = email.text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no URL in email: ${email.text}`);
  return match[0];
}

/** Collapse Set-Cookie headers into a Cookie header for follow-up requests. */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((pair) => !pair.endsWith('=')) // drop deletions
    .join('; ');
}

async function signUp(email: string, password: string): Promise<void> {
  const res = await app.request(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: email.split('@')[0] }),
  });
  expect(res.status).toBe(200);
}

async function verifyLatestEmail(): Promise<void> {
  const url = extractUrl(lastEmailMatching(/verify/i));
  const res = await app.request(url);
  // Better Auth redirects to the callbackURL after verifying
  expect([200, 302]).toContain(res.status);
}

async function signIn(email: string, password: string): Promise<Response> {
  return app.request(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
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

  // Mirror the prod wiring in index.ts: session middleware → auth handler →
  // a probe route standing in for the user-data routes, → the same onError
  // passthrough for the identity seam's fail-closed HTTPException.
  app = new Hono();
  app.use('/api/*', makeSessionMiddleware(true, () => engine));
  app.on(['POST', 'GET'], '/api/auth/*', (c) => engine.handler(c.req.raw));
  app.get('/api/whoami', (c) => c.json({ userId: resolveUserId(true, c) }));
  app.get('/api/tokens', (c) => c.json({ tokens: [] }));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    return c.json({ error: 'Internal Server Error' }, 500);
  });
});

afterAll(() => {
  setEmailTransport(null);
});

describe('cloud mode rejects unauthenticated access', () => {
  test('no session → 401 before any route runs', async () => {
    const res = await app.request(`${BASE}/api/whoami`);
    expect(res.status).toBe(401);
  });

  test('Bearer tokens are rejected, not silently ignored — PATs carry no tenant yet', async () => {
    const res = await app.request(`${BASE}/api/whoami`, {
      headers: { Authorization: 'Bearer some-pat' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('cloud mode');
  });

  test('/api/auth/* stays reachable unauthenticated (signup/login must work logged-out)', async () => {
    const res = await app.request(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
    });
    // 401 from Better Auth (bad credentials), NOT the middleware's own 401 —
    // the request reached the engine.
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBeDefined();
  });
});

describe('signup → verify → sign in → session resolves the tenant', () => {
  const EMAIL = 'reader@example.com';
  const PASSWORD = 'correct-horse-battery';

  test('signup creates an unverified user and sends a verification email', async () => {
    await signUp(EMAIL, PASSWORD);
    const mail = lastEmailMatching(/verify/i);
    expect(mail.to).toBe(EMAIL);
    expect(extractUrl(mail)).toContain('/api/auth/verify-email');
  });

  test('sign-in before verification is refused', async () => {
    const res = await signIn(EMAIL, PASSWORD);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('the emailed link verifies the address; sign-in then issues a session', async () => {
    await verifyLatestEmail();
    const res = await signIn(EMAIL, PASSWORD);
    expect(res.status).toBe(200);
    expect(cookiesFrom(res)).toContain('session_token');
  });

  test('the session cookie authenticates API requests and resolves a stable userId', async () => {
    const signin = await signIn(EMAIL, PASSWORD);
    const cookie = cookiesFrom(signin);
    const res = await app.request(`${BASE}/api/whoami`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { userId } = (await res.json()) as { userId: string };
    expect(userId.length).toBeGreaterThan(0);
    expect(userId).not.toBe(LOCAL_USER_ID);

    // Same session again → same tenant
    const again = await app.request(`${BASE}/api/whoami`, { headers: { Cookie: cookie } });
    expect(((await again.json()) as { userId: string }).userId).toBe(userId);
  });

  test('wrong password → 401', async () => {
    const res = await signIn(EMAIL, 'not-the-password');
    expect(res.status).toBe(401);
  });

  test('two accounts resolve two distinct tenants', async () => {
    await signUp('second@example.com', PASSWORD);
    await verifyLatestEmail();
    const [a, b] = await Promise.all([signIn(EMAIL, PASSWORD), signIn('second@example.com', PASSWORD)]);
    const who = async (res: Response) => {
      const r = await app.request(`${BASE}/api/whoami`, { headers: { Cookie: cookiesFrom(res) } });
      return ((await r.json()) as { userId: string }).userId;
    };
    const [userA, userB] = [await who(a), await who(b)];
    expect(userA).not.toBe(userB);
  });

  test('PAT management stays unreachable in cloud even with a session (table is untenanted)', async () => {
    const signin = await signIn(EMAIL, PASSWORD);
    const res = await app.request(`${BASE}/api/tokens`, {
      headers: { Cookie: cookiesFrom(signin) },
    });
    expect(res.status).toBe(403);
  });
});

describe('password reset', () => {
  const EMAIL = 'forgetful@example.com';
  const OLD_PASSWORD = 'original-password-1';
  const NEW_PASSWORD = 'brand-new-password-2';

  test('request → emailed link → reset → old password dead, new one works', async () => {
    await signUp(EMAIL, OLD_PASSWORD);
    await verifyLatestEmail();

    const req = await app.request(`${BASE}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, redirectTo: '/reset' }),
    });
    expect(req.status).toBe(200);

    const url = extractUrl(lastEmailMatching(/reset/i));
    const token = url.match(/reset-password\/([^?#]+)/)?.[1] ?? new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = await app.request(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
    });
    expect(reset.status).toBe(200);

    expect((await signIn(EMAIL, OLD_PASSWORD)).status).toBe(401);
    expect((await signIn(EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  test('reset request for an unknown email does not leak whether the account exists', async () => {
    const res = await app.request(`${BASE}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@example.com', redirectTo: '/reset' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('turnstile captcha (when configured)', () => {
  test('sign-up without an x-captcha-response token is rejected before touching the user store', async () => {
    const guarded = createAuthEngine({
      database: new Database(':memory:'),
      baseURL: BASE,
      secret: 'test-secret-000000000000000000000000',
      trustedOrigins: [BASE],
      turnstileSecretKey: 'turnstile-test-secret',
    });
    await runAuthMigrations(guarded);
    const guardedApp = new Hono();
    guardedApp.on(['POST', 'GET'], '/api/auth/*', (c) => guarded.handler(c.req.raw));

    const res = await guardedApp.request(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bot@example.com', password: 'password-123456', name: 'bot' }),
    });
    expect(res.ok).toBe(false);
    // Fails closed locally (MISSING_RESPONSE) — no siteverify network call.
    expect(res.status).toBeLessThan(500);
  });

  test('the engine without a turnstile key loads no captcha plugin (selfhost/dev default)', () => {
    expect(engine.options.plugins ?? []).toHaveLength(0);
  });
});

describe('selfhost stays auth-off single-user', () => {
  test('the passthrough middleware never consults the engine and the seam resolves "local"', async () => {
    const selfhost = new Hono();
    // engine thunk that would explode if the selfhost path ever touched it
    selfhost.use(
      '/api/*',
      makeSessionMiddleware(false, () => {
        throw new Error('selfhost must not construct the auth engine');
      }),
    );
    selfhost.get('/api/whoami', (c) => c.json({ userId: resolveUserId(false, c) }));

    const res = await selfhost.request('http://localhost/api/whoami');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe(LOCAL_USER_ID);
  });

  test('the identity seam fails closed in cloud when no middleware ran (wiring bug ≠ shared tenant)', () => {
    expect(() => resolveUserId(true, undefined)).toThrow(HTTPException);
  });
});
