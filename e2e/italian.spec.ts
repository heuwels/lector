import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';
import { pickLanguage } from './language-helpers';

const COLLECTION = 'Italian E2E';

async function switchToItalian(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const selector = page.locator('aside').getByTestId('language-selector');
  await expect(selector).toBeVisible();
  await selector.click();
  await pickLanguage(page, 'it');
  await expect(selector).toContainText('Italiano');
}

async function deleteItalianDemo(page: Page) {
  const res = await page.request.get(apiUrl('/api/collections'));
  const collections = await res.json();
  for (const collection of collections) {
    if (collection.title === COLLECTION) {
      await page.request.delete(apiUrl(`/api/collections/${collection.id}`));
    }
  }
}

test.describe('Italian language pack', () => {
  test.afterEach(async ({ page }) => {
    await deleteItalianDemo(page);
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'af' } });
  });

  test('reader keeps an elision whole and defines the content word', async ({ page }) => {
    await switchToItalian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'it' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: 'Primo capitolo',
        textContent: "C'è l'italiano qui. Un'amica beve l'acqua.",
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // The reported bug: the apostrophe must not split the word.
    await expect(page.getByText("C'è", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("l'italiano", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Un'amica", { exact: true }).first()).toBeVisible();
    await expect(page.getByText('italiano', { exact: true })).toHaveCount(0);
    await expect(page.getByText('amica', { exact: true })).toHaveCount(0);

    // Click the reader token, not any text node that contains it. WordCell
    // labels each token `Look up <token>`, so this cannot match the lesson
    // title in the banner.
    await page.getByRole('button', { name: "Look up l'italiano", exact: true }).click();
    // role=dialog carries aria-hidden={!isOpen}, so this locator resolves only
    // when the drawer is open. The test id also matches the closed drawer,
    // which stays mounted and only moves off screen.
    const drawer = page.getByRole('dialog', { name: "Definition of l'italiano" });
    await expect(drawer).toBeVisible();
    // Assert the peel, not a substring of the word in the drawer heading. The
    // dictionary holds no l'italiano, so italiano must arrive as the stem.
    await expect(drawer.getByTestId('lemma-stem-link')).toHaveText('italiano', {
      timeout: 10000,
    });
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible();
  });

  test("reader defines C'è from the on-device dictionary", async ({ page }) => {
    await switchToItalian(page);

    const colRes = await page.request.post(apiUrl('/api/collections'), {
      data: { title: COLLECTION, language: 'it' },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
      data: {
        title: "C'è",
        textContent: "C'è un'amica qui.",
      },
    });
    const lessons = await (
      await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`))
    ).json();

    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState('networkidle');

    // The lesson title is also C'è, and the banner heading comes before the
    // article. A text locator matched that heading, so the click never reached
    // a word and the dictionary was never asked.
    const word = page.getByRole('button', { name: "Look up C'è", exact: true });
    await expect(word).toBeVisible({ timeout: 10000 });
    await word.click();
    const drawer = page.getByRole('dialog', { name: "Definition of C'è" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('on-device', { exact: false })).toBeVisible({
      timeout: 10000,
    });
  });

  test('the live lookup API peels an elision and folds the apostrophe', async ({ page }) => {
    const peeled = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent("l'italiano")}&language=it`),
      )
    ).json();
    expect(peeled.entry?.lemmaInfo?.stem ?? peeled.entry?.word).toBe('italiano');

    const curly = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent('l’italiano')}&language=it`),
      )
    ).json();
    expect(curly.entry?.lemmaInfo?.stem ?? curly.entry?.word).toBe('italiano');

    const contraction = await (
      await page.request.get(
        apiUrl(`/api/dictionary/lookup?word=${encodeURIComponent("C'è")}&language=it`),
      )
    ).json();
    expect(contraction.entry).toBeTruthy();
    expect(contraction.entry?.source).toBe('dict');
  });
});
