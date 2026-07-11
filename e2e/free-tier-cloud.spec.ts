import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

const FREE_API = `http://localhost:${process.env.E2E_FREE_API_PORT || '3473'}`;
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-free-data', 'emails.jsonl');
const EMAIL = `free+${Date.now()}@e2e.test`;
const PASSWORD = 'free-tier-password-123';

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no Free billing API in the external-server run');

async function configureFreeEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: FREE_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
}

async function lastVerifyLink(address: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    let contents = '';
    try {
      contents = readFileSync(EMAILS, 'utf8');
    } catch {
      // The file outbox is created on first delivery.
    }
    const mail = contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
      .reverse()
      .find((item) => item.to === address && /verify/i.test(item.subject));
    const url = mail?.text.match(/https?:\/\/\S+/)?.[0];
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no verification email to ${address}`);
}

async function signIn(page: Page) {
  await configureFreeEnv(page);
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => url.pathname === '/');
}

test.describe.serial('Free cloud learning loop', () => {
  test('a verified no-card account reaches setup and the app', async ({ page }) => {
    await configureFreeEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Free Reader');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();

    await page.goto(await lastVerifyLink(EMAIL));
    await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
    expect(page.url()).not.toContain('/subscribe');

    await page.getByTestId('setup-language-af').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('account-email')).toHaveText(EMAIL);
  });

  test('Free has app access, bounded AI, browser audio, and portable data', async ({ page }) => {
    await signIn(page);

    const billing = await page.request.get(`${FREE_API}/api/billing/status`);
    expect(billing.status()).toBe(200);
    expect(await billing.json()).toMatchObject({
      enforced: true,
      accessAllowed: true,
      subscriptionActive: false,
      freeTierEnabled: true,
    });

    const entitlements = await page.request.get(`${FREE_API}/api/billing/entitlements`);
    expect(entitlements.status()).toBe(200);
    expect(await entitlements.json()).toMatchObject({
      plan: 'free',
      byok: false,
      limits: {
        wordGlossesPerMonth: 1000,
        phraseTranslationsPerDay: 10,
        contextTranslationsPerDay: 10,
        ttsCharsPerMonth: 0,
      },
    });

    expect((await page.request.get(`${FREE_API}/api/collections`)).status()).toBe(200);
    expect((await page.request.get(`${FREE_API}/api/data`)).status()).toBe(200);
  });

  test('Settings presents BYOK and paid managed voice as distinct escape hatches', async ({
    page,
  }) => {
    await signIn(page);
    await page.route(`${FREE_API}/api/tts`, () => {
      throw new Error('Free voice playback must stay in the browser');
    });
    await page.goto('/settings');

    const plan = page.getByTestId('cloud-plan-settings');
    await expect(plan.getByText('Free is active for this account.')).toBeVisible();
    await expect(plan.getByText(/starter and imported texts/i)).toBeVisible();
    await expect(plan.getByRole('link', { name: /bring your own AI key/i })).toBeVisible();

    const byok = page.locator('#byok');
    await expect(byok.getByText(/Free includes a small managed Gemini allowance/i)).toBeVisible();
    await expect(byok.getByLabel('OpenRouter API key')).toBeVisible();

    const tts = page.getByTestId('tts-settings');
    await expect(tts.getByText('Browser voice · Free')).toBeVisible();
    await expect(tts.getByRole('button', { name: 'Managed voice' })).toBeDisabled();
    await expect(tts.getByRole('link', { name: 'Upgrade to Cloud' })).toBeVisible();
    await tts.getByRole('button', { name: 'Test Voice' }).click();
    await page.waitForTimeout(100);
  });

  test('the plan screen describes the complete bounded Free loop', async ({ page }) => {
    await signIn(page);
    await page.goto('/subscribe');

    const free = page.getByTestId('subscribe-tier-free');
    await expect(free).toBeVisible();
    await expect(free.getByText(/starter lessons and texts you import/i)).toBeVisible();
    await expect(free.getByText(/sync with Anki/i)).toBeVisible();
    await expect(free.getByText(/Bring your own AI key/i)).toBeVisible();
    await expect(free.getByText(/Export your learner data/i)).toBeVisible();

    await page.getByTestId('subscribe-continue-free').click();
    await page.waitForURL((url) => url.pathname === '/');
  });
});
