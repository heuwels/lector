import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * The Paddle billing gate (#224), end to end: a fresh verified account lands
 * locked on /subscribe (no free tier), every gated API call 402s while data
 * takeout stays open, a signed Paddle webhook (played by this spec) flips the
 * account active and the app opens, and a later cancellation locks it again.
 *
 * The UI is the shared :3456 next dev server pointed (via the __env.js rail)
 * at the billing-armed cloud API on :3469. Webhooks are signed here with the
 * same secret the server holds — Paddle never appears: checkout is created
 * server-side and opens on lector.dev's approved domain, out of this suite's
 * reach, so the redirect is exercised against a mocked /api/billing/checkout
 * (the 'starting checkout redirects…' test). The enforcement around it is ours.
 */

const CLOUD_API = `http://localhost:${process.env.E2E_BILLING_API_PORT || '3469'}`;
const WEBHOOK_SECRET = 'e2e-paddle-webhook-secret';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-billing-data', 'emails.jsonl');

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no billing-mode API in the external-server run');

// Unique per worker, same reasoning as auth-cloud.spec.ts: a serial-block
// retry gets a fresh module (new address) against a server that keeps the
// earlier attempt's rows.
const EMAIL = `payer+${Date.now()}@e2e.test`;
const PASSWORD = 'billing-password-123';
const CUSTOMER_ID = `ctm_e2e_${Date.now()}`;
const SUBSCRIPTION_ID = `sub_e2e_${Date.now()}`;

async function useBillingEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: CLOUD_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
}

function lastVerifyLink(address: string): string {
  const mail = readFileSync(EMAILS, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
    .reverse()
    .find((m) => m.to === address && /verify/i.test(m.subject));
  if (!mail) throw new Error(`no verification email to ${address}`);
  const url = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no URL in email: ${mail.text}`);
  return url;
}

/** Sign a webhook body exactly as Paddle does: HMAC-SHA256 over `ts:body`. */
function paddleSignature(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}:${body}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function subscriptionEvent(status: string): string {
  return JSON.stringify({
    event_type: 'subscription.updated',
    occurred_at: new Date().toISOString(),
    data: {
      id: SUBSCRIPTION_ID,
      status,
      customer_id: CUSTOMER_ID,
      custom_data: null,
      current_billing_period: { ends_at: '2999-01-01T00:00:00Z' },
      items: [{ price: { id: 'pri_e2e_monthly' } }],
    },
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
}

test.describe.serial('billing gate lifecycle', () => {
  test('a fresh verified account is locked onto /subscribe with takeout intact', async ({
    page,
  }) => {
    await useBillingEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Payer');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();

    // Verify → auto-sign-in → BillingGuard finds no subscription → /subscribe.
    await page.goto(lastVerifyLink(EMAIL));
    await page.waitForURL('**/subscribe');
    await expect(page.getByTestId('subscribe-panel')).toBeVisible();
    // No prices / CHECKOUT_URL on the e2e server → the graceful fallback.
    await expect(page.getByText(/Checkout isn't available/)).toBeVisible();
    // Chrome-free: no nav for a locked account.
    await expect(page.locator('aside')).toHaveCount(0);

    // Server-side enforcement, with the session cookie the browser holds:
    // gated reads/writes 402, takeout (GET /api/data) stays open, import
    // (POST /api/data) does not.
    const collections = await page.request.get(`${CLOUD_API}/api/collections`);
    expect(collections.status()).toBe(402);
    expect((await collections.json()).error).toBe('subscription_required');
    expect((await page.request.get(`${CLOUD_API}/api/data`)).status()).toBe(200);
    expect((await page.request.post(`${CLOUD_API}/api/data`, { data: {} })).status()).toBe(402);
  });

  test('a signed Paddle webhook unlocks the account', async ({ page, request }) => {
    // The `request` fixture carries no cookies: the webhook route needs none.
    // customer.created carries the email that links the Paddle customer to
    // the account; the subscription event references that customer.
    const customerBody = JSON.stringify({
      event_type: 'customer.created',
      occurred_at: new Date().toISOString(),
      data: { id: CUSTOMER_ID, email: EMAIL },
    });
    const customerRes = await request.post(`${CLOUD_API}/api/billing/webhook`, {
      headers: { 'Paddle-Signature': paddleSignature(customerBody) },
      data: customerBody,
    });
    expect(customerRes.status()).toBe(200);

    const subBody = subscriptionEvent('active');
    const subRes = await request.post(`${CLOUD_API}/api/billing/webhook`, {
      headers: { 'Paddle-Signature': paddleSignature(subBody) },
      data: subBody,
    });
    expect(subRes.status()).toBe(200);
    expect((await subRes.json()).applied).toBe('subscription');

    // An unsigned (or badly signed) event is refused and changes nothing.
    const forged = subscriptionEvent('canceled');
    const forgedRes = await request.post(`${CLOUD_API}/api/billing/webhook`, {
      headers: { 'Paddle-Signature': 'ts=1;h1=deadbeef' },
      data: forged,
    });
    expect(forgedRes.status()).toBe(401);

    // The paid account signs in and gets the actual app, not /subscribe.
    await useBillingEnv(page);
    await signIn(page);
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
    expect((await page.request.get(`${CLOUD_API}/api/collections`)).status()).toBe(200);
  });

  test('cancellation locks the account again, back onto /subscribe', async ({ page, request }) => {
    const body = subscriptionEvent('canceled');
    const res = await request.post(`${CLOUD_API}/api/billing/webhook`, {
      headers: { 'Paddle-Signature': paddleSignature(body) },
      data: body,
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).applied).toBe('subscription');

    await useBillingEnv(page);
    await signIn(page);
    await page.waitForURL('**/subscribe');
    // The lapsed variant of the screen: data intact, renewal is the way back.
    await expect(page.getByText('Your subscription has ended')).toBeVisible();
    await expect(page.getByTestId('subscribe-export')).toBeVisible();
    expect((await page.request.get(`${CLOUD_API}/api/data`)).status()).toBe(200);
    expect((await page.request.get(`${CLOUD_API}/api/collections`)).status()).toBe(402);
  });

  test('starting checkout redirects to the site with the transaction id', async ({ page }) => {
    const CHECKOUT = 'https://lector.test/checkout';
    // Runtime env: point the browser at the billing API and give it a
    // marketing checkout URL (the real e2e server ships neither prices nor
    // CHECKOUT_URL, so the screen would otherwise show its fallback).
    await page.route('**/__env.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.__ENV__ = ${JSON.stringify({
          API_URL: CLOUD_API,
          LECTOR_MODE: 'cloud',
          CHECKOUT_URL: CHECKOUT,
        })};`,
      }),
    );
    // Inject a plan so the locked screen renders a tile, and stub the API's
    // Paddle transaction creation — the overlay itself lives on lector.dev.
    await page.route(`${CLOUD_API}/api/billing/status`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          enforced: true,
          accessAllowed: false,
          subscriptionActive: false,
          freeTierEnabled: false,
          suspended: false,
          exempt: false,
          status: 'none',
          checkout: { prices: [{ id: 'pri_e2e_monthly', plan: 'cloud', cycle: 'month' }] },
        }),
      }),
    );
    await page.route(`${CLOUD_API}/api/billing/checkout`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ txnId: 'txn_e2e_redirect' }),
      }),
    );
    // Absorb the cross-site navigation so it resolves without a real network hit.
    await page.route('https://lector.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>checkout</title>' }),
    );

    await signIn(page);
    await page.waitForURL('**/subscribe');
    await page.getByTestId('subscribe-price-cloud-month').click();
    await page.waitForURL(/lector\.test\/checkout\?_ptxn=txn_e2e_redirect/);
    expect(page.url()).toContain('_ptxn=txn_e2e_redirect');
  });
});
