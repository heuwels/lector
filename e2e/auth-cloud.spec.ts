import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Cloud-mode auth flows (#218), end to end in a real browser: register →
 * verification email → verify → sign in → tenant-scoped app → sign out →
 * password reset via emailed link → sign in with the new password →
 * personal API token minted in Settings and used as a Bearer credential.
 *
 * The UI is the shared :3456 next dev server; window.__ENV__ is stubbed per
 * page to point the browser at the cloud-mode API on :3462 (its own
 * DATA_DIR; LECTOR_TRUSTED_ORIGINS covers the UI origin). Emails land in
 * tmp/e2e-data-cloud/emails.jsonl via EMAIL_FILE — the specs read the
 * verification/reset links back out. No Turnstile keys are set, so the
 * widget stays absent and captcha stays off, matching keyless deployments.
 */

const CLOUD_API = 'http://localhost:3462';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-data-cloud', 'emails.jsonl');

// The external-server (docker) run boots one selfhost container and no cloud
// API — cloud boot behaviour is asserted by CI's docker steps instead.
test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no cloud-mode API in the external-server run');

// Unique per worker: a serial-block retry restarts in a fresh worker (module
// re-evaluated → new address) against a server that keeps earlier attempts'
// accounts — a constant email would find itself already registered/verified.
const EMAIL = `reader+${Date.now()}@e2e.test`;
const PASSWORD = 'first-password-123';
const NEW_PASSWORD = 'second-password-456';

async function useCloudEnv(page: Page, extraEnv: Record<string, string> = {}) {
  // Fulfil /__env.js instead of stubbing window.__ENV__ from an init script:
  // the checked-in public/__env.js dev stub executes after init scripts and
  // would clobber the stub. This drives the exact runtime-config rail
  // docker-entrypoint.sh uses in production.
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: CLOUD_API, LECTOR_MODE: 'cloud', ...extraEnv })};`,
    }),
  );
}

function emailsTo(address: string): { subject: string; text: string }[] {
  try {
    return readFileSync(EMAILS, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((m: { to: string }) => m.to === address);
  } catch {
    return [];
  }
}

function lastLink(address: string, subjectMatch: RegExp): string {
  const mail = emailsTo(address)
    .reverse()
    .find((m) => subjectMatch.test(m.subject));
  if (!mail) throw new Error(`no email to ${address} matching ${subjectMatch}`);
  const url = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no URL in email: ${mail.text}`);
  return url;
}

test.describe.serial('cloud auth lifecycle', () => {
  test('unauthenticated visit bounces to /login', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('register → verification email → verify link signs the user in', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Reader');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();

    // Signing in before verifying is refused with the resend affordance.
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-unverified-notice')).toBeVisible();

    // The emailed link verifies and (autoSignInAfterVerification) lands in
    // the app with a session: the account chrome is up.
    const verifyUrl = lastLink(EMAIL, /verify/i);
    expect(verifyUrl).toContain(`${CLOUD_API}/api/auth/verify-email`);
    await page.goto(verifyUrl);
    await page.waitForURL('http://localhost:3456/**');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  // Each test runs in a fresh browser context (no cookies carry over), so
  // every test below establishes its own session through the UI.
  test('sign in with the password; sign out returns to /login', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);

    // Scope to the desktop sidebar — the mobile top-bar copy is display-hidden.
    await page.locator('aside').getByTestId('account-sign-out').click();
    await page.waitForURL('**/login');
  });

  test('password reset via emailed link; old password dead, new one works', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/reset-password');
    await page.getByTestId('reset-email').fill(EMAIL);
    await page.getByTestId('reset-submit').click();
    await expect(page.getByTestId('reset-check-email')).toBeVisible();

    // The emailed link redirects back to /reset-password?token=…
    const resetUrl = lastLink(EMAIL, /reset/i);
    await page.goto(resetUrl);
    await page.waitForURL('**/reset-password?token=**');
    await page.getByTestId('reset-new-password').fill(NEW_PASSWORD);
    await page.getByTestId('reset-confirm').click();
    await page.waitForURL('**/login');

    // Old password refused…
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();

    // …new one signs in.
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  test('personal API token: mint in Settings → Bearer authenticates cookie-free → revoke kills it', async ({
    page,
    request,
  }) => {
    await useCloudEnv(page);
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => url.pathname === '/');

    // This account has never chosen a language, and the tenant-keyed cache
    // (#281) means the suite's seeded browser-scoped key no longer stands in
    // for it — complete onboarding once so SetupGuard lets /settings render.
    await page.goto('/setup');
    await page.getByTestId('setup-language-af').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await page.waitForURL((url) => url.pathname === '/');

    // Mint a token in the Settings UI (session-authenticated — reachable in
    // cloud now that api_tokens is tenanted, #218).
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Generate Token' }).click();
    await page.getByPlaceholder(/e\.g\. CLI/).fill('e2e-cloud-pat');
    await page.getByRole('button', { name: 'Create Token', exact: true }).click();
    const token = (await page.locator('code', { hasText: /^ltr_/ }).textContent()) ?? '';
    expect(token).toMatch(/^ltr_/);

    // The `request` fixture shares no browser state: the Bearer token is the
    // only credential, and it resolves this user's tenant.
    const withToken = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
    const ok = await request.get(`${CLOUD_API}/api/collections`, withToken(token));
    expect(ok.status()).toBe(200);

    // An unknown token is refused — Bearer requests never fall through.
    const bad = await request.get(`${CLOUD_API}/api/collections`, withToken('ltr_bogus'));
    expect(bad.status()).toBe(401);

    // A token cannot manage tokens (no minting successors from a leaked key).
    const mgmt = await request.get(`${CLOUD_API}/api/tokens`, withToken(token));
    expect(mgmt.status()).toBe(403);

    // Revoke in the UI → the token stops authenticating.
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: "I've saved this token" }).click();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No tokens created yet', { exact: false })).toBeVisible();
    const dead = await request.get(`${CLOUD_API}/api/collections`, withToken(token));
    expect(dead.status()).toBe(401);
  });
});

// The BYO OIDC button is driven purely by the runtime flag rail (#218):
// docker-entrypoint.sh writes OIDC_LOGIN/OIDC_PROVIDER_NAME into __env.js when
// the API has a provider configured. Render-only — the OAuth dance needs a
// live IdP; the engine tests cover config down to the plugin boundary.
test.describe('BYO OIDC login button', () => {
  test('renders with the provider name when the flag is set, absent otherwise', async ({
    page,
  }) => {
    await useCloudEnv(page, { OIDC_LOGIN: '1', OIDC_PROVIDER_NAME: 'Authentik' });
    await page.goto('/login');
    await expect(page.getByTestId('login-oidc')).toHaveText('Continue with Authentik');

    await useCloudEnv(page); // back to the flagless cloud env
    await page.goto('/login');
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.getByTestId('login-oidc')).toHaveCount(0);
  });
});
