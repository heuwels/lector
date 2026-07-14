import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Cloud-mode account deletion (#227, right-to-erasure), end to end: register →
 * verify → sign in → confirm deletion in Settings → follow the emailed
 * confirmation link → the account is erased and the browser lands back on
 * /login with the deletion notice, and the old credentials no longer work.
 *
 * Same harness as auth-cloud.spec.ts: the shared :3456 next UI, a cloud-mode
 * API on :3462, and emails read back out of tmp/e2e-data-cloud/emails.jsonl.
 */

const CLOUD_API = 'http://localhost:3462';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-data-cloud', 'emails.jsonl');

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no cloud-mode API in the external-server run');

// Unique per worker (a serial-block retry restarts in a fresh worker against a
// server that kept earlier attempts' accounts — a constant email would collide).
const EMAIL = `deleter+${Date.now()}@e2e.test`;
const PASSWORD = 'delete-me-please-123';

async function useCloudEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: CLOUD_API, LECTOR_MODE: 'cloud' })};`,
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

test.describe.serial('cloud account deletion', () => {
  test('register → verification link signs the user in', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Deleter');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();

    const verifyUrl = lastLink(EMAIL, /verify/i);
    await page.goto(verifyUrl);
    await page.waitForURL('http://localhost:3456/**');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  test('Settings → delete → emailed link erases the account and bounces to /login', async ({
    page,
  }) => {
    await useCloudEnv(page);
    await page.goto('/login');
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => url.pathname === '/');

    // /settings is behind SetupGuard — complete onboarding once so it renders:
    // pick a language, then skip the guided first-loop walkthrough (#360).
    await page.goto('/setup');
    await page.getByTestId('setup-language-af').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await page.waitForURL((url) => url.pathname === '/');

    // Confirm deletion: reveal the danger zone, type the confirm phrase, submit.
    await page.goto('/settings');
    await page.getByTestId('delete-account-start').click();
    await page.getByTestId('delete-account-confirm-input').fill('DELETE');
    await page.getByTestId('delete-account-confirm').click();
    await expect(page.getByTestId('delete-account-sent')).toBeVisible();

    // The emailed link (same browser → session present) completes the deletion
    // and redirects to /login?deleted=1.
    const deleteUrl = lastLink(EMAIL, /delet/i);
    expect(deleteUrl).toContain(`${CLOUD_API}/api/auth/delete-user/callback`);
    await page.goto(deleteUrl);
    await page.waitForURL('**/login?deleted=1');
    await expect(page.getByTestId('login-deleted-notice')).toBeVisible();

    // The account is gone: the old credentials no longer authenticate.
    await page.getByTestId('login-email').fill(EMAIL);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });
});
