import { test, expect, type Page } from '@playwright/test';
import { apiUrl } from './api';

// The REAL Spanish starter series (#317), exercised against the production
// Docker image — the inverse of starter-content.spec.ts's fixture tests. Dev
// servers point STARTER_CONTENT_ROOT at fixtures, so the shipped pack is only
// reachable in the E2E_EXTERNAL_SERVER pass, where the image carries
// languages/es/content/starter/ and the baked dictionaries.
const externalServer = !!process.env.E2E_EXTERNAL_SERVER;

async function resetSpanish(page: Page) {
  const res = await page.request.get(apiUrl('/api/collections?language=es'));
  for (const c of (await res.json()) as { id: string }[]) {
    await page.request.delete(apiUrl(`/api/collections/${c.id}?language=es`));
  }
  await page.request.delete(apiUrl('/api/settings/starterSeeded:es'));
}

test.describe('shipped Spanish starter series (#317, production image only)', () => {
  test.skip(!externalServer, 'the real pack is only reachable in the Docker-image pass');

  test('selecting Español seeds the series; lesson 1 reads and defines', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await resetSpanish(page);
    await page.request.delete(apiUrl('/api/settings/targetLanguage'));

    // The pack is genuinely available in the image.
    const status = (await (
      await page.request.get(apiUrl('/api/starter/status?language=es'))
    ).json()) as { available: boolean };
    expect(status.available).toBe(true);

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 15000 });
    await page.getByTestId('setup-language-es').click();
    await expect(page).toHaveURL('/', { timeout: 15000 });

    // The full series lands on the first paint.
    await expect(page.getByText('Tus primeras 1000 palabras').first()).toBeVisible({
      timeout: 15000,
    });
    const collections = (await (
      await page.request.get(apiUrl('/api/collections?language=es'))
    ).json()) as { id: string; lessonCount: number }[];
    const starter = collections.find((c) => c.id === 'starter-es');
    expect(starter?.lessonCount).toBe(20);

    // Open lesson 1 and read.
    await page.locator('h3', { hasText: 'Tus primeras 1000 palabras' }).first().click();
    await expect(page.getByText('Yo soy Ana').first()).toBeVisible();
    await page.getByText('Yo soy Ana', { exact: true }).first().click();
    await expect(page.getByText('Mi nombre es Ana').first()).toBeVisible({ timeout: 15000 });

    // The quality gate the series is built on: tap a word, get a definition
    // from the baked dictionary.
    await page.getByText('ciudad', { exact: true }).first().click();
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(drawer.getByText('ciudad').first()).toBeVisible();

    // Leave the shared image DB the way the suite expects it.
    await resetSpanish(page);
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
    await context.close();
  });
});
