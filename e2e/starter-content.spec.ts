import { test, expect, type Page } from '@playwright/test';
import { apiUrl } from './api';
import { mockSetupSkipPersistence } from './onboarding-helpers';

// Starter-content seeding (#315). The dev-mode API serves a fixture 'es'
// starter pack via STARTER_CONTENT_ROOT (playwright.config.ts) — real packs
// ship with #317+. The selfhost suite shares one 'local' user and one DB, so
// each test first makes its language pristine (collections + seeded flag +
// targetLanguage), making the spec independent of what ran before it.

const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

async function deleteCollections(page: Page, language: string) {
  const res = await page.request.get(apiUrl(`/api/collections?language=${language}`));
  for (const c of (await res.json()) as { id: string }[]) {
    await page.request.delete(apiUrl(`/api/collections/${c.id}?language=${language}`));
  }
}

async function resetLanguage(page: Page, language: string) {
  await deleteCollections(page, language);
  await page.request.delete(apiUrl(`/api/settings/starterSeeded:${language}`));
}

async function restoreAfrikaans(page: Page) {
  // The rest of the suite assumes the shared user's server-side language is af.
  await page.request.put(apiUrl('/api/settings/targetLanguage'), {
    data: { value: 'af' },
  });
}

test.describe('starter content seeding (#315)', () => {
  test.skip(externalServer, 'fixture starter pack is not shipped in the production image');

  test('first selection of Spanish seeds the starter collection into the library', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await resetLanguage(page, 'es');
    await page.request.delete(apiUrl('/api/settings/targetLanguage'));

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 15000 });
    await mockSetupSkipPersistence(page);
    await page.getByTestId('setup-language-es').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await expect(page).toHaveURL('/', { timeout: 15000 });

    // The starter collection is there on the FIRST library paint.
    await expect(page.getByText('Starter Fixture ES').first()).toBeVisible({ timeout: 15000 });

    // Open it: both lessons are listed, in order, and lesson 1 reads.
    await page
      .getByRole('link', { name: /Starter Fixture ES/ })
      .first()
      .click();
    await expect(page).toHaveURL('/collection/starter-es');
    await expect(page.getByText('Hola', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('La casa').first()).toBeVisible();
    await page.getByText('Hola', { exact: true }).first().click();
    await expect(page.getByText('Me llamo Ana')).toBeVisible({ timeout: 15000 });

    // Re-selecting the language must not duplicate the collection.
    const seedAgain = await page.request.post(apiUrl('/api/starter/seed'), {
      data: { language: 'es' },
    });
    expect(((await seedAgain.json()) as { seeded: boolean }).seeded, 'no re-seed').toBe(false);
    const collections = (await (
      await page.request.get(apiUrl('/api/collections?language=es'))
    ).json()) as { id: string }[];
    expect(collections.filter((c) => c.id === 'starter-es')).toHaveLength(1);

    await resetLanguage(page, 'es');
    await restoreAfrikaans(page);
    await context.close();
  });

  test('empty-library CTA offers the starter pack to a user who selected the language before seeding shipped', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: 'http://localhost:3456',
            localStorage: [{ name: 'lector-target-language', value: 'es' }],
          },
        ],
      },
    });
    const page = await context.newPage();

    await resetLanguage(page, 'es');
    // Selected server-side, but never seeded — the pre-#315 state.
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'es' } });

    await page.goto('/');
    const cta = page.getByTestId('add-starter-content');
    await expect(cta).toBeVisible({ timeout: 15000 });
    await cta.click();
    await expect(page.getByText('Starter Fixture ES').first()).toBeVisible({ timeout: 15000 });

    // Once seeded, deleting the collection does NOT bring the CTA back — the
    // flag (which survives the delete) makes seeding once-ever.
    await deleteCollections(page, 'es');
    await page.reload();
    await expect(page.getByText('No books in your library')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('add-starter-content')).not.toBeVisible();

    await resetLanguage(page, 'es');
    await restoreAfrikaans(page);
    await context.close();
  });
});

// Runs everywhere, including against the production image. es and de now ship a
// starter series, so this edge uses a pack that does NOT: af has a wordlist but
// no manifest, so hasStarterContent is false and selecting it must behave
// exactly as before, with nothing seeded.
test.describe('starter content absent (#315 edge)', () => {
  test('selecting a language without starter content leaves the library untouched', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    const status = (await (
      await page.request.get(apiUrl('/api/starter/status?language=af'))
    ).json()) as { available: boolean };
    expect(status.available).toBe(false);

    const before = (await (
      await page.request.get(apiUrl('/api/collections?language=af'))
    ).json()) as { id: string }[];

    await page.request.delete(apiUrl('/api/settings/targetLanguage'));
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 15000 });
    await mockSetupSkipPersistence(page);
    await page.getByTestId('setup-language-af').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await expect(page).toHaveURL('/', { timeout: 15000 });
    await expect(page.getByText('Your Library').first()).toBeVisible({ timeout: 15000 });

    const after = (await (
      await page.request.get(apiUrl('/api/collections?language=af'))
    ).json()) as { id: string }[];
    expect(after.length).toBe(before.length);
    expect(after.find((c) => c.id === 'starter-af')).toBeUndefined();

    await restoreAfrikaans(page);
    await context.close();
  });
});
