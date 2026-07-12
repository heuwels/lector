import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Admin dashboard (#221), end to end against the admin cloud API on :3471
 * (LECTOR_ADMIN_EMAILS=operator@e2e.test). Asserts OUR gating + UI:
 *   - the operator account sees the Admin nav link and dashboard with every
 *     account listed; an ordinary account sees neither (403 + no link),
 *   - suspending an account locks it out of normal routes while data takeout
 *     stays open, and restoring it reopens access.
 *
 * Each account gets its own browser context (no sign-out dance), the standard
 * multi-user pattern; accounts persist server-side across the serial block.
 */

const ADMIN_API = `http://localhost:${process.env.E2E_ADMIN_API_PORT || '3471'}`;
const EMAILS_FILE = path.join(__dirname, '..', 'tmp', 'e2e-admin-data', 'emails.jsonl');

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no admin-mode API in the external-server run');

const ADMIN_EMAIL = 'operator@e2e.test';
const USER_EMAIL = `member+${Date.now()}@e2e.test`;
const PASSWORD = 'admin-spec-password-123';

async function applyAdminEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: ADMIN_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
}

/** A page in its own context (isolated cookies), pre-wired to the admin API. */
async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await applyAdminEnv(page);
  return page;
}

async function lastVerifyLink(address: string): Promise<string> {
  // The email write can lag the register response — poll the outbox briefly.
  for (let i = 0; i < 40; i++) {
    let contents = '';
    try {
      contents = readFileSync(EMAILS_FILE, 'utf8');
    } catch {
      /* file not created yet */
    }
    const mail = contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
      .reverse()
      .find((m) => m.to === address && /verify/i.test(m.subject));
    const url = mail?.text.match(/https?:\/\/\S+/)?.[0];
    if (url) return url;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no verification email to ${address}`);
}

async function registerAndVerify(browser: Browser, name: string, email: string): Promise<Page> {
  const page = await freshPage(browser);
  await page.goto('/register');
  await page.getByTestId('register-name').fill(name);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-check-email')).toBeVisible();
  // The verify link auto-signs-in (Better Auth), establishing the session
  // cookie in this context.
  await page.goto(await lastVerifyLink(email));
  await page.waitForLoadState('networkidle');
  // Seed the account's language so SetupGuard doesn't bounce every navigation
  // to /setup (a fresh account has no target language yet). Authenticated via
  // the context's session cookie.
  const res = await page.request.put(`${ADMIN_API}/api/settings`, {
    data: { targetLanguage: 'af' },
  });
  expect(res.ok()).toBeTruthy();
  return page;
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await freshPage(browser);
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => url.pathname === '/');
  return page;
}

test.describe.serial('admin dashboard (#221)', () => {
  test('creates the operator and an ordinary account', async ({ browser }) => {
    await registerAndVerify(browser, 'Operator', ADMIN_EMAIL);
    await registerAndVerify(browser, 'Member', USER_EMAIL);
  });

  test('an ordinary account has no Admin link and is refused by the API', async ({ browser }) => {
    const page = await signIn(browser, USER_EMAIL);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

    const res = await page.request.get(`${ADMIN_API}/api/admin/users`);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('admin_required');

    await page.goto('/admin');
    await expect(page.getByText(/don’t have access|don't have access/)).toBeVisible();
  });

  test('the operator sees the dashboard listing every account, and can search', async ({
    browser,
  }) => {
    const page = await signIn(browser, ADMIN_EMAIL);
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
    await page.getByRole('link', { name: 'Admin' }).click();
    await page.waitForURL('**/admin');

    const table = page.locator('table');
    await expect(table.getByText(ADMIN_EMAIL)).toBeVisible();
    await expect(table.getByText(USER_EMAIL)).toBeVisible();

    // Search filters the table down to the matching account (scope to the
    // table — the operator's own email also shows in the sidebar account menu).
    await page.getByPlaceholder(/search email/i).fill(USER_EMAIL);
    await expect(table.getByText(USER_EMAIL)).toBeVisible();
    await expect(table.getByText(ADMIN_EMAIL)).toHaveCount(0);

    const summary = await page.request.get(`${ADMIN_API}/api/admin/summary`);
    expect(summary.status()).toBe(200);
    expect((await summary.json()).users).toBeGreaterThanOrEqual(2);
  });

  test('password-reset drives the real Better Auth flow and is audit-logged', async ({
    browser,
  }) => {
    const operator = await signIn(browser, ADMIN_EMAIL);
    const users = (await (await operator.request.get(`${ADMIN_API}/api/admin/users`)).json())
      .users as Array<{ id: string; email: string }>;
    const member = users.find((u) => u.email === USER_EMAIL)!;

    const res = await operator.request.post(
      `${ADMIN_API}/api/admin/users/${member.id}/password-reset`,
    );
    expect(res.status()).toBe(200);

    // The real engine (not a stub) sent a reset email to the member's address.
    await expect
      .poll(() =>
        readFileSync(EMAILS_FILE, 'utf8')
          .split('\n')
          .filter(Boolean)
          .some((l) => {
            const m = JSON.parse(l) as { to: string; subject: string };
            return m.to === USER_EMAIL && /reset/i.test(m.subject);
          }),
      )
      .toBe(true);

    // And the action is on the audit trail, attributed to the operator.
    const audit = (await (await operator.request.get(`${ADMIN_API}/api/admin/audit`)).json())
      .entries as Array<{ action: string; actorEmail: string; targetEmail: string }>;
    const entry = audit.find((e) => e.action === 'password_reset' && e.targetEmail === USER_EMAIL);
    expect(entry?.actorEmail).toBe(ADMIN_EMAIL);
  });

  test('suspending an account locks it out; takeout stays open; restore reopens', async ({
    browser,
  }) => {
    const operator = await signIn(browser, ADMIN_EMAIL);
    const list = await operator.request.get(`${ADMIN_API}/api/admin/users`);
    const users = (await list.json()).users as Array<{ id: string; email: string }>;
    const member = users.find((u) => u.email === USER_EMAIL)!;
    expect(member).toBeTruthy();

    const suspend = await operator.request.post(
      `${ADMIN_API}/api/admin/users/${member.id}/suspend`,
      { data: { reason: 'e2e abuse' } },
    );
    expect(suspend.status()).toBe(200);

    // The suspended member is locked out of normal routes; takeout stays open.
    const blockedMember = await signIn(browser, USER_EMAIL);
    const blocked = await blockedMember.request.get(`${ADMIN_API}/api/collections`);
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error).toBe('account_suspended');
    expect((await blockedMember.request.get(`${ADMIN_API}/api/data`)).status()).toBe(200);

    const restore = await operator.request.post(
      `${ADMIN_API}/api/admin/users/${member.id}/restore`,
    );
    expect(restore.status()).toBe(200);

    // Usable again.
    const restoredMember = await signIn(browser, USER_EMAIL);
    expect((await restoredMember.request.get(`${ADMIN_API}/api/collections`)).status()).toBe(200);
  });
});
