import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * TOTP two-factor auth (cloud mode), end to end in a real browser: enrol in
 * Settings (QR + manual secret → verify a code → backup codes), sign out,
 * password sign-in lands on /two-factor and a generated authenticator code
 * completes it, a backup code stands in when the authenticator is "lost",
 * and disabling restores plain password sign-in.
 *
 * Codes come from the on-screen manual-entry secret via a plain RFC-6238
 * implementation — the browser-visible enrolment data is enough to run a
 * Google-Authenticator-compatible TOTP, which is exactly the interop the
 * feature promises. Server-side verification behaviour (rotation, lockout,
 * single-use codes) is pinned in api/src/lib/two-factor.test.ts.
 */

const CLOUD_API = 'http://localhost:3462';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-data-cloud', 'emails.jsonl');

// The external-server (docker) run boots one selfhost container and no cloud
// API — cloud boot behaviour is asserted by CI's docker steps instead.
test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no cloud-mode API in the external-server run');

const EMAIL = `totp+${Date.now()}@e2e.test`;
const PASSWORD = 'totp-password-123';

async function useCloudEnv(page: Page) {
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
    .filter((m) => m.to === address)
    .reverse()
    .find((m) => /verify/i.test(m.subject));
  if (!mail) throw new Error(`no verification email to ${address}`);
  const url = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`no URL in email: ${mail.text}`);
  return url;
}

/** RFC 4648 base32 → bytes, as an authenticator app decodes the setup key. */
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

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30s) from the manual-entry secret. */
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
}

// Enrolment state carried across the serial lifecycle.
let totpSecret = '';
let backupCode = '';

test.describe.serial('TOTP two-factor lifecycle', () => {
  test('register, verify, and complete onboarding', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Careful Reader');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();

    // The emailed link verifies and signs in; onboarding once lets
    // SetupGuard render /settings for the rest of the lifecycle.
    await page.goto(lastVerifyLink(EMAIL));
    await page.waitForURL('http://localhost:3456/**');
    await page.goto('/setup');
    await page.getByTestId('setup-language-af').click();
    await page.waitForURL((url) => url.pathname === '/');
  });

  test('enrol: QR + manual secret shown, a live code arms it, backup codes handed over once', async ({
    page,
  }) => {
    await useCloudEnv(page);
    await signIn(page);
    await page.waitForURL((url) => url.pathname === '/');

    await page.goto('/settings');
    await expect(page.getByTestId('twofactor-status')).toContainText('off');

    await page.getByTestId('twofactor-enable').click();
    await page.getByTestId('twofactor-password').fill(PASSWORD);
    await page.getByTestId('twofactor-password-submit').click();

    // Enrolment panel: a scannable QR plus the same secret for manual entry.
    await expect(page.getByTestId('twofactor-qr').locator('svg')).toBeVisible();
    totpSecret = (await page.getByTestId('twofactor-secret').textContent())?.trim() ?? '';
    expect(totpSecret.length).toBeGreaterThan(15);

    // Backup codes are on screen now — keep one for the recovery test.
    backupCode =
      (await page.getByTestId('twofactor-backup-codes').locator('span').first().textContent())?.trim() ??
      '';
    expect(backupCode.length).toBeGreaterThan(5);

    // "Scan" the secret into our authenticator and feed back the live code.
    await page.getByTestId('twofactor-verify-code').fill(totp(totpSecret));
    await page.getByTestId('twofactor-verify-submit').click();

    await expect(page.getByTestId('twofactor-status')).toContainText('on');
    await page.getByTestId('twofactor-codes-saved').click();
    await expect(page.getByTestId('twofactor-backup-codes')).toHaveCount(0);
    await expect(page.getByTestId('twofactor-disable')).toBeVisible();
  });

  test('sign-in demands the authenticator code, then reaches the app', async ({ page }) => {
    await useCloudEnv(page);
    await signIn(page);

    // Password alone no longer signs in — the challenge page takes over.
    await page.waitForURL('**/two-factor');
    await page.getByTestId('twofactor-code').fill(totp(totpSecret));
    await page.getByTestId('twofactor-submit').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  test('a wrong code is refused and stays on the challenge', async ({ page }) => {
    await useCloudEnv(page);
    await signIn(page);
    await page.waitForURL('**/two-factor');
    await page.getByTestId('twofactor-code').fill('000000');
    await page.getByTestId('twofactor-submit').click();
    await expect(page.getByText('That code didn’t work', { exact: false })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/two-factor');
  });

  test('a backup code recovers a lost authenticator', async ({ page }) => {
    await useCloudEnv(page);
    await signIn(page);
    await page.waitForURL('**/two-factor');

    await page.getByTestId('twofactor-toggle-backup').click();
    await page.getByTestId('twofactor-code').fill(backupCode);
    await page.getByTestId('twofactor-submit').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  test('disable restores plain password sign-in', async ({ page }) => {
    await useCloudEnv(page);
    await signIn(page);
    await page.waitForURL('**/two-factor');
    await page.getByTestId('twofactor-code').fill(totp(totpSecret));
    await page.getByTestId('twofactor-submit').click();
    await page.waitForURL((url) => url.pathname === '/');

    await page.goto('/settings');
    await page.getByTestId('twofactor-disable').click();
    await page.getByTestId('twofactor-password').fill(PASSWORD);
    await page.getByTestId('twofactor-password-submit').click();
    await expect(page.getByTestId('twofactor-status')).toContainText('off');

    // Scope to the desktop sidebar — the mobile top-bar copy is display-hidden.
    await page.locator('aside').getByTestId('account-sign-out').click();
    await page.waitForURL('**/login');
    await signIn(page);
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });
});
