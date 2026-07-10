import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * The plan-limits engine (#222), end to end against the billing-armed cloud
 * API on :3469 (same server as billing-cloud.spec.ts, whose env sets
 * LECTOR_PLAN_LIMITS journalWordsPerMonth=25 for exactly this suite):
 *
 *   - an entitled account reads its plan + limits from /api/billing/entitlements,
 *   - a journal save within the allowance lands and is metered,
 *   - a save that would cross the cap is refused with 429 plan_limit
 *     server-side, and the UI turns it into a soft upsell toast — the app
 *     keeps working (no error wall, no redirect).
 */

const CLOUD_API = 'http://localhost:3469';
const WEBHOOK_SECRET = 'e2e-paddle-webhook-secret';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-billing-data', 'emails.jsonl');

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no billing-mode API in the external-server run');

const EMAIL = `limited+${Date.now()}@e2e.test`;
const PASSWORD = 'plan-limits-password-123';
const CUSTOMER_ID = `ctm_e2e_limits_${Date.now()}`;
const SUBSCRIPTION_ID = `sub_e2e_limits_${Date.now()}`;

async function useBillingEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: CLOUD_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
}

async function lastVerifyLink(address: string): Promise<string> {
  // The email write can lag the register response — poll the outbox briefly.
  for (let i = 0; i < 40; i++) {
    let contents = '';
    try {
      contents = readFileSync(EMAILS, 'utf8');
    } catch {
      /* not created yet */
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

function paddleSignature(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `woord${i}`).join(' ');
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('plan limits (#222)', () => {
  test('an entitled account sees its plan and limits', async ({ page, request }) => {
    // Register + verify (same machinery as billing-cloud.spec.ts).
    await useBillingEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Limited');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();
    await page.goto(await lastVerifyLink(EMAIL));
    await page.waitForURL('**/subscribe');

    // Entitle via signed Paddle webhooks: the customer links the email, the
    // subscription carries pri_e2e_monthly → the 'cloud' plan.
    const customerBody = JSON.stringify({
      event_type: 'customer.created',
      occurred_at: new Date().toISOString(),
      data: { id: CUSTOMER_ID, email: EMAIL },
    });
    expect(
      (
        await request.post(`${CLOUD_API}/api/billing/webhook`, {
          headers: { 'Paddle-Signature': paddleSignature(customerBody) },
          data: customerBody,
        })
      ).status(),
    ).toBe(200);
    const subBody = JSON.stringify({
      event_type: 'subscription.updated',
      occurred_at: new Date().toISOString(),
      data: {
        id: SUBSCRIPTION_ID,
        status: 'active',
        customer_id: CUSTOMER_ID,
        custom_data: null,
        current_billing_period: { ends_at: '2999-01-01T00:00:00Z' },
        items: [{ price: { id: 'pri_e2e_monthly' } }],
      },
    });
    expect(
      (
        await request.post(`${CLOUD_API}/api/billing/webhook`, {
          headers: { 'Paddle-Signature': paddleSignature(subBody) },
          data: subBody,
        })
      ).status(),
    ).toBe(200);

    // The webhook 200'd, but poll the same status endpoint BillingGuard
    // reads before navigating, so the guard can never race the mirror.
    await expect
      .poll(async () => {
        const res = await page.request.get(`${CLOUD_API}/api/billing/status`);
        return ((await res.json()) as { active: boolean }).active;
      })
      .toBe(true);

    // Seed the account's language so SetupGuard doesn't bounce later UI
    // navigations (the /journal editor in the last test) to /setup. Persists
    // server-side, so subsequent sign-ins in this serial block pass the guard.
    const seed = await page.request.put(`${CLOUD_API}/api/settings`, {
      data: { targetLanguage: 'af' },
    });
    expect(seed.ok()).toBeTruthy();

    // Entitlements read straight from the API (the verify link already
    // established this context's session cookie) — no fragile UI navigation.
    const ent = await page.request.get(`${CLOUD_API}/api/billing/entitlements`);
    expect(ent.status()).toBe(200);
    const body = (await ent.json()) as {
      plan: string;
      limits: { journalWordsPerMonth: number };
      usage: { journalWordsPerMonth: number };
    };
    expect(body.plan).toBe('cloud');
    expect(body.limits.journalWordsPerMonth).toBe(25);
    expect(body.usage.journalWordsPerMonth).toBe(0);
  });

  test('a journal save inside the allowance lands and is metered', async ({ page }) => {
    await useBillingEnv(page);
    await signIn(page);
    const res = await page.request.post(`${CLOUD_API}/api/journal`, {
      data: { body: words(20) },
    });
    expect(res.status()).toBe(200);

    const ent = await page.request.get(`${CLOUD_API}/api/billing/entitlements`);
    expect(((await ent.json()) as { usage: { journalWordsPerMonth: number } }).usage.journalWordsPerMonth).toBe(20);
  });

  test('crossing the cap 429s server-side and shows a soft upsell in the UI', async ({ page }) => {
    await useBillingEnv(page);
    await signIn(page);

    // Server-side: 6 more words would make 26/25 — refused, nothing saved.
    const over = await page.request.post(`${CLOUD_API}/api/journal`, {
      data: { body: words(6) },
    });
    expect(over.status()).toBe(429);
    const payload = (await over.json()) as Record<string, unknown>;
    expect(payload.error).toBe('plan_limit');
    expect(payload.metric).toBe('journalWordsPerMonth');
    expect(payload.upgrade).toBe('plus');

    // UI grace: the same action through the journal editor produces the
    // upsell toast — and the app stays usable (no redirect, no error wall).
    await page.goto('/journal');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'New Entry' }).click();
    await page.getByPlaceholder(/journal entry in/i).fill(words(6));
    await page.getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByText('Monthly journal limit reached')).toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain('/journal');

    // Still within-allowance actions keep working after the refusal.
    const ok = await page.request.post(`${CLOUD_API}/api/journal`, {
      data: { body: words(5) },
    });
    expect(ok.status()).toBe(200);
  });
});
