import { test, expect, type Page, type Browser } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

const ADMIN_API = `http://localhost:${process.env.E2E_ADMIN_API_PORT || '3471'}`;
const EMAILS_FILE = path.join(__dirname, '..', 'tmp', 'e2e-admin-data', 'emails.jsonl');

test.skip(!!process.env.E2E_EXTERNAL_SERVER, 'no cloud-mode API in the external-server run');

const ADMIN_EMAIL = 'operator@e2e.test';
const USER_A = `share-a+${Date.now()}@e2e.test`;
const USER_B = `share-b+${Date.now()}@e2e.test`;
const PASSWORD = 'community-spec-password-123';
const OPERATOR_PASSWORD = 'admin-spec-password-123';

async function applyCloudEnv(page: Page) {
  await page.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: ADMIN_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
}

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await applyCloudEnv(page);
  return page;
}

async function lastVerifyLink(address: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    let contents = '';
    try {
      contents = readFileSync(EMAILS_FILE, 'utf8');
    } catch {
      /* not yet */
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

async function registerAndSetup(
  browser: Browser,
  name: string,
  email: string,
  password: string,
): Promise<Page> {
  const page = await freshPage(browser);
  await page.goto('/register');
  await page.getByTestId('register-name').fill(name);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(password);
  await page.getByTestId('register-submit').click();
  const checkEmail = page.getByTestId('register-check-email');
  if (await checkEmail.isVisible().catch(() => false)) {
    await page.goto(await lastVerifyLink(email));
    await page.waitForLoadState('networkidle');
  } else {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/setup');
  }
  const res = await page.request.put(`${ADMIN_API}/api/settings`, {
    data: { targetLanguage: 'es' },
  });
  expect(res.ok()).toBeTruthy();
  return page;
}

test('self-host hides the Community nav link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('nav-community')).toHaveCount(0);
});

test.describe.serial('cloud community library', () => {
  test('operator, Alice, and Bob share one instance catalog', async ({ browser }) => {
    const adminPage = await registerAndSetup(browser, 'Operator', ADMIN_EMAIL, OPERATOR_PASSWORD);
    const alice = await registerAndSetup(browser, 'Alice', USER_A, PASSWORD);
    const bob = await registerAndSetup(browser, 'Bob', USER_B, PASSWORD);

    await expect(alice.getByTestId('nav-community')).toBeVisible();

    const created = await alice.request.post(`${ADMIN_API}/api/collections`, {
      data: { title: 'La casa', author: 'Ada', language: 'es' },
    });
    expect(created.ok()).toBeTruthy();
    const { id: collectionId } = (await created.json()) as { id: string };
    const lesson = await alice.request.post(
      `${ADMIN_API}/api/collections/${collectionId}/lessons`,
      {
        data: { title: 'Uno', textContent: 'Hola casa amiga.' },
      },
    );
    expect(lesson.ok()).toBeTruthy();

    await alice.goto(`/collection/${collectionId}`);
    await alice.getByTestId('community-submit').click();
    await alice.getByTestId('community-submit-attest').check();
    await alice.getByTestId('community-submit-confirm').click();
    await alice.waitForURL('**/community**');

    await adminPage.goto('/admin');
    await adminPage.getByTestId('admin-tab-community').click();
    await expect(adminPage.getByTestId('admin-community-queue')).toBeVisible();
    await adminPage.getByRole('button', { name: 'Approve' }).click();
    await expect(adminPage.getByText('Published')).toBeVisible();

    await bob.goto('/community');
    await expect(bob.getByText('La casa')).toBeVisible();
    await bob.getByRole('button', { name: 'Add to library' }).click();
    await bob.getByTestId('community-clone-confirm').click();
    await bob.waitForURL('**/collection/**');
    await expect(bob.getByRole('heading', { name: 'La casa' })).toBeVisible();

    await bob.goto('/community');
    await bob.getByLabel('Down-vote').click();
    await expect(bob.locator('[data-testid^="community-score-"]')).toHaveText('-1');

    await alice.goto('/community?mine=1');
    await alice.getByTestId('community-tab-mine').click();
    await expect(alice.getByText('published')).toBeVisible();
  });
});
