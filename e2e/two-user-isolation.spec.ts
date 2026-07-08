import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * #220 — per-user libraries, proven end-to-end: two real accounts on a
 * cloud-mode API (Better Auth sessions), each with an isolated library.
 *
 * The UI is the ordinary Next dev server (:3456) — the browser is pointed at
 * the cloud API by injecting window.__ENV__ per context, and each
 * BrowserContext is its own cookie jar, i.e. its own signed-in user. The
 * cloud API (:3467) is the extra Playwright webServer in playwright.config.ts
 * with a fresh DATA_DIR and a file email outbox this spec reads verification
 * links from.
 */

const CLOUD_API = 'http://localhost:3467';
const UI_ORIGIN = 'http://localhost:3456';
const OUTBOX = path.join(__dirname, '..', 'tmp', 'e2e-cloud-data', 'outbox.jsonl');
const PASSWORD = 'wagwoord-vir-toetse-123';
const EPUB = path.join(__dirname, 'fixtures', 'test-book.epub');

// Better Auth's CSRF protection 403s session-issuing posts without an Origin
// header; browsers always send one, so the spec's request calls must too.
const AUTH_HEADERS = { Origin: UI_ORIGIN };

test.skip(
  !!process.env.E2E_EXTERNAL_SERVER,
  'the cloud-mode API webServer is not booted when testing an external server',
);

interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
}

/** Latest verification link sent to `email`, polling the outbox file. */
async function verificationLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        let raw: string;
        try {
          raw = readFileSync(OUTBOX, 'utf8');
        } catch {
          return false; // outbox not written yet
        }
        const messages = raw
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as OutboxMessage);
        const match = [...messages]
          .reverse()
          .find((m) => m.to === email && /verify/i.test(m.subject));
        link = match?.text.match(/https?:\/\/\S+/)?.[0];
        return !!link;
      },
      { timeout: 10_000, message: `no verification email for ${email}` },
    )
    .toBe(true);
  return link!;
}

/**
 * A browser context signed in as a brand-new user: sign-up → email
 * verification (via the outbox link) → sign-in. The context's request
 * fixture shares its cookie jar, so pages opened afterwards carry the
 * session.
 */
async function newUserContext(browser: Browser, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  // The app reads its runtime config from /__env.js (written by
  // docker-entrypoint.sh in a real deployment; an empty default in dev).
  // Serve the cloud config for this context — an init script won't do, since
  // the real /__env.js loads beforeInteractive and would overwrite it.
  await ctx.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = { API_URL: ${JSON.stringify(CLOUD_API)}, LECTOR_MODE: 'cloud' };`,
    }),
  );

  const signUp = await ctx.request.post(`${CLOUD_API}/api/auth/sign-up/email`, {
    headers: AUTH_HEADERS,
    data: { email, password: PASSWORD, name: email.split('@')[0] },
  });
  expect(signUp.status(), await signUp.text()).toBe(200);

  const verify = await ctx.request.get(await verificationLink(email), {
    headers: AUTH_HEADERS,
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(verify.status());

  const signIn = await ctx.request.post(`${CLOUD_API}/api/auth/sign-in/email`, {
    headers: AUTH_HEADERS,
    data: { email, password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  return ctx;
}

/** Import the fixture EPUB in this context's session; returns the new ids. */
async function importFixtureEpub(ctx: BrowserContext): Promise<{ collectionId: string; lessonId: string }> {
  const res = await ctx.request.post(`${CLOUD_API}/api/import/epub`, {
    multipart: {
      file: { name: 'test-book.epub', mimeType: 'application/epub+zip', buffer: readFileSync(EPUB) },
      language: 'af',
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  const { collectionId } = (await res.json()) as { collectionId: string };

  const lessons = await ctx.request.get(`${CLOUD_API}/api/collections/${collectionId}/lessons`);
  const [firstLesson] = (await lessons.json()) as { id: string }[];
  expect(firstLesson).toBeTruthy();
  return { collectionId, lessonId: firstLesson.id };
}

test.describe('two users, isolated libraries (#220)', () => {
  test('signup → onboarding → import: each user sees only their own library', async ({ browser }) => {
    test.setTimeout(120_000);

    // Unique addresses per attempt: retries run against the same live server
    // and DB, and a re-signup of an existing address 422s.
    const run = Date.now();
    const anna = await newUserContext(browser, `anna-${run}@example.com`);
    const bernd = await newUserContext(browser, `bernd-${run}@example.com`);

    // ---- Anna: brand-new user onboarding — language setup, then the empty
    // library state. Her settings live server-side under HER tenant.
    const annaPage = await anna.newPage();
    await annaPage.goto('/');
    await expect(annaPage).toHaveURL(/\/setup/, { timeout: 15_000 });
    await annaPage.getByTestId('setup-language-af').click();
    await expect(annaPage).toHaveURL('/', { timeout: 15_000 });
    await expect(annaPage.getByText('No books in your library')).toBeVisible({ timeout: 15_000 });

    // Anna imports a book; her library shows it.
    const annasBook = await importFixtureEpub(anna);
    await annaPage.reload();
    await expect(annaPage.getByText('Toets Boek').first()).toBeVisible({ timeout: 15_000 });

    // ---- Bernd: his onboarding is his own (Anna's targetLanguage must not
    // leak into his fresh account), and his library is empty despite Anna's
    // import.
    const berndPage = await bernd.newPage();
    await berndPage.goto('/');
    await expect(berndPage).toHaveURL(/\/setup/, { timeout: 15_000 });
    await berndPage.getByTestId('setup-language-af').click();
    await expect(berndPage).toHaveURL('/', { timeout: 15_000 });
    await expect(berndPage.getByText('No books in your library')).toBeVisible({ timeout: 15_000 });
    await expect(berndPage.getByText('Toets Boek')).toHaveCount(0);

    // Bernd's API view: Anna's collection is absent from lists and 404s by id.
    const berndCollections = await bernd.request.get(`${CLOUD_API}/api/collections?language=af`);
    expect(((await berndCollections.json()) as { id: string }[]).map((c) => c.id)).not.toContain(
      annasBook.collectionId,
    );
    expect((await bernd.request.get(`${CLOUD_API}/api/collections/${annasBook.collectionId}?language=af`)).status()).toBe(404);
    expect((await bernd.request.get(`${CLOUD_API}/api/lessons/${annasBook.lessonId}?language=af`)).status()).toBe(404);

    // Symmetry: Bernd imports too; Anna's library must not grow.
    const berndsBook = await importFixtureEpub(bernd);
    const annaCollections = await anna.request.get(`${CLOUD_API}/api/collections?language=af`);
    const annaIds = ((await annaCollections.json()) as { id: string }[]).map((c) => c.id);
    expect(annaIds).toContain(annasBook.collectionId);
    expect(annaIds).not.toContain(berndsBook.collectionId);

    // Anna's UI still shows exactly her book after Bernd's activity.
    await annaPage.reload();
    await expect(annaPage.getByText('Toets Boek').first()).toBeVisible({ timeout: 15_000 });

    await anna.close();
    await bernd.close();
  });

  test('no session → no library: the API refuses unauthenticated reads', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    expect((await anon.get(`${CLOUD_API}/api/collections?language=af`)).status()).toBe(401);
    await anon.dispose();
  });
});
