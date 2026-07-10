import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Anki in cloud mode (#241): the browser-direct AnkiConnect path is
 * selfhost-only — Chrome's Local Network Access blocks a public HTTPS origin
 * from calling localhost:8765, so cloud syncs through the Lector Anki addon
 * against server-side endpoints instead. Covered here:
 *
 *   - Settings shows the addon setup panel and (the actual regression this
 *     started from) never fires the doomed browser probe at localhost:8765.
 *   - The vocab page swaps the connection pill for the addon pill, hides the
 *     browser pull-sync button, and Export to Anki queues server-side.
 *   - The addon's API lifecycle with an anki-scoped token: pending → ack
 *     (flips pushedToAnki) → review push (upgrade-only reconcile + import),
 *     plus scope enforcement (a vocab-scoped token is refused).
 *   - Selfhost regression: the AnkiConnect panel is unchanged (plan 010's
 *     "selfhost behaviour holds" invariant).
 *
 * Cloud runs against the :3462 cloud-mode API (same server as
 * auth-cloud.spec.ts); the UI is the shared :3456 next dev with window.__ENV__
 * fulfilled per page.
 */

const CLOUD_API = 'http://localhost:3462';
const EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-data-cloud', 'emails.jsonl');

// The external-server (docker) run boots one selfhost container and no cloud
// API; the selfhost describe below still runs there.
const NO_CLOUD = !!process.env.E2E_EXTERNAL_SERVER;

const EMAIL = `anki+${Date.now()}@e2e.test`;
const PASSWORD = 'anki-addon-password-123';

async function useCloudEnv(page: Page) {
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

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/setup');
}

/** Count browser-originated requests to a local AnkiConnect. */
function trackAnkiProbes(page: Page): { count: () => number } {
  let probes = 0;
  page.route('**://localhost:8765/**', (route) => {
    probes++;
    route.abort();
  });
  return { count: () => probes };
}

test.describe.serial('Anki in cloud mode (#241)', () => {
  test.skip(NO_CLOUD, 'no cloud-mode API in the external-server run');

  let vocabId: string;
  let ankiToken: string;

  test('register, verify, and onboard the account', async ({ page }) => {
    await useCloudEnv(page);
    await page.goto('/register');
    await page.getByTestId('register-name').fill('Anki Tester');
    await page.getByTestId('register-email').fill(EMAIL);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-check-email')).toBeVisible();
    await page.goto(await lastVerifyLink(EMAIL));
    await page.waitForURL('http://localhost:3456/**');

    // Onboard server-side (the setup page is its own spec's concern): the
    // session cookie rides page.request against the API origin.
    const res = await page.request.put(`${CLOUD_API}/api/settings/targetLanguage`, {
      data: { value: 'af' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('settings shows the addon panel and never probes localhost:8765', async ({ page }) => {
    await useCloudEnv(page);
    const probes = trackAnkiProbes(page);
    await signIn(page);

    await page.goto('/settings');
    await expect(page.getByTestId('anki-addon-panel')).toBeVisible();
    await expect(page.getByTestId('anki-addon-api-url')).toHaveValue(CLOUD_API);
    // The browser-direct panel (AnkiConnect URL + connection dot) must be gone…
    await expect(page.getByText('AnkiConnect URL')).not.toBeVisible();
    // …and, the actual canary regression: no doomed fetch to loopback.
    await page.waitForLoadState('networkidle');
    expect(probes.count()).toBe(0);
  });

  test('vocab page: addon pill, no pull-sync button, export queues server-side', async ({ page }) => {
    await useCloudEnv(page);
    const probes = trackAnkiProbes(page);
    await signIn(page);

    // Seed one entry through the API (session-cookie authenticated).
    const created = await page.request.post(`${CLOUD_API}/api/vocab`, {
      data: {
        text: 'huis',
        type: 'word',
        sentence: 'Die huis is groot.',
        translation: 'The house is big.',
        state: 'new',
        language: 'af',
      },
    });
    expect(created.ok()).toBeTruthy();
    vocabId = ((await created.json()) as { id: string }).id;

    await page.goto('/vocab');
    await expect(page.getByTestId('anki-addon-pill')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync with Anki' })).not.toBeVisible();

    // Select the seeded row and export — in cloud this queues server-side.
    await expect(page.getByText('huis').first()).toBeVisible();
    await page.locator('tbody input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: /Export to Anki \(1\)/ }).click();
    await page.getByTestId('anki-card-type-basic').click();
    await page.getByTestId('anki-export-confirm').click();
    await expect(page.getByText(/Queued 1 basic card/)).toBeVisible({ timeout: 5000 });

    expect(probes.count()).toBe(0);
  });

  test('the addon lifecycle over the API with an anki-scoped token', async ({ page, request }) => {
    await useCloudEnv(page);
    await signIn(page);

    // Mint the addon's token in-session (PATs can't mint PATs).
    const minted = await page.request.post(`${CLOUD_API}/api/tokens`, {
      data: { name: 'anki-addon-e2e', scopes: ['anki:*'] },
    });
    expect(minted.status()).toBe(201);
    ankiToken = ((await minted.json()) as { token: string }).token;
    const bearer = { Authorization: `Bearer ${ankiToken}` };

    // Pull: the card queued in the previous test, render-ready.
    const pendingRes = await request.get(`${CLOUD_API}/api/anki/pending`, { headers: bearer });
    expect(pendingRes.ok()).toBeTruthy();
    const { pending } = (await pendingRes.json()) as {
      pending: Array<{ lectorId: string; cardType: string; lang: string; sentenceHtml: string }>;
    };
    const item = pending.find((p) => p.lectorId === vocabId);
    expect(item).toBeTruthy();
    expect(item!.cardType).toBe('basic');
    expect(item!.lang).toBe('af');
    expect(item!.sentenceHtml).toBe('Die <b>huis</b> is groot.');

    // Ack: flips pushedToAnki + stores the note id, clears the queue.
    const ackRes = await request.post(`${CLOUD_API}/api/anki/ack`, {
      headers: bearer,
      data: { results: [{ lectorId: vocabId, cardType: 'basic', noteId: 1720000000000 }] },
    });
    expect(((await ackRes.json()) as { acked: number }).acked).toBe(1);

    const afterAck = (await (
      await page.request.get(`${CLOUD_API}/api/vocab/${vocabId}`)
    ).json()) as { pushedToAnki: boolean; ankiNoteId: number };
    expect(afterAck.pushedToAnki).toBe(true);
    expect(afterAck.ankiNoteId).toBe(1720000000000);

    const emptied = (await (
      await request.get(`${CLOUD_API}/api/anki/pending`, { headers: bearer })
    ).json()) as { pending: unknown[] };
    expect(emptied.pending).toEqual([]);

    // Push: a mature card upgrades the entry; an unmatched studied word is
    // imported as vocab (both mirror the old browser sync, structured).
    const reviewsRes = await request.post(`${CLOUD_API}/api/anki/reviews`, {
      headers: bearer,
      data: {
        reviews: [
          { lectorId: vocabId, word: 'huis', lang: 'af', type: 2, interval: 30 },
          {
            word: 'berge', lang: 'af', type: 2, interval: 5, noteId: 7,
            sentence: 'Die berge is hoog.', translation: 'The mountains are high.',
          },
        ],
        reviewsByDay: [['2026-07-10', 17]],
      },
    });
    const summary = (await reviewsRes.json()) as { updated: number; created: number; syncedDays: number };
    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.syncedDays).toBe(1);

    const upgraded = (await (
      await page.request.get(`${CLOUD_API}/api/vocab/${vocabId}`)
    ).json()) as { state: string };
    expect(upgraded.state).toBe('known');

    const all = (await (
      await page.request.get(`${CLOUD_API}/api/vocab?language=af`)
    ).json()) as Array<{ text: string; state: string }>;
    expect(all.find((v) => v.text === 'berge')?.state).toBe('level4');
  });

  test('a token without the anki scope is refused', async ({ page, request }) => {
    await useCloudEnv(page);
    await signIn(page);
    const minted = await page.request.post(`${CLOUD_API}/api/tokens`, {
      data: { name: 'vocab-only-e2e', scopes: ['vocab:*'] },
    });
    const vocabToken = ((await minted.json()) as { token: string }).token;

    const res = await request.get(`${CLOUD_API}/api/anki/pending`, {
      headers: { Authorization: `Bearer ${vocabToken}` },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('Anki settings in selfhost mode (#241 invariant)', () => {
  test('the browser-direct AnkiConnect panel is unchanged', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('AnkiConnect URL')).toBeVisible();
    await expect(page.getByTestId('anki-addon-panel')).not.toBeVisible();
  });
});
