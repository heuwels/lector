import { test, expect, Page } from '@playwright/test';

const TEST_TITLE = 'Inline Edit Test';
const ORIGINAL_TEXT = 'Die son skyn helder vandag. Ek loop deur die veld.';
const EDITED_TEXT = 'Die maan skyn helder vannag. Ek loop deur die straat.';

async function createLesson(page: Page): Promise<{ collectionId: string; lessonId: string }> {
  const colRes = await page.request.post('/api/collections', {
    data: { title: TEST_TITLE, language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(`/api/collections/${collectionId}/lessons`, {
    data: { title: 'Hoofstuk 1', textContent: ORIGINAL_TEXT },
  });

  const lessonsRes = await page.request.get(`/api/collections/${collectionId}/lessons`);
  const lessons = await lessonsRes.json();
  return { collectionId, lessonId: lessons[0].id };
}

async function cleanupExisting(page: Page) {
  const res = await page.request.get('/api/collections');
  const collections = await res.json();
  for (const c of collections) {
    if (c.title === TEST_TITLE) {
      await page.request.delete(`/api/collections/${c.id}`);
    }
  }
}

test.describe('Reader inline editing (issue #67)', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cleanupExisting(page);
    const created = await createLesson(page);
    collectionId = created.collectionId;
    await page.goto(`/read/${created.lessonId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('helder', { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(`/api/collections/${collectionId}`);
    }
  });

  test('edit button toggles textarea, save persists changes', async ({ page }) => {
    const editButton = page.getByTestId('edit-text-button');
    await expect(editButton).toBeVisible();

    // Article rendered, textarea not yet present
    await expect(page.locator('article')).toBeVisible();
    await expect(page.getByTestId('edit-text-textarea')).toHaveCount(0);

    await editButton.click();

    // Textarea now visible with the original content
    const textarea = page.getByTestId('edit-text-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(ORIGINAL_TEXT);

    // Article (tokenized view) is hidden in edit mode
    await expect(page.locator('article')).toHaveCount(0);

    // Edit button itself is gone, replaced by Cancel/Save
    await expect(page.getByTestId('edit-text-button')).toHaveCount(0);
    await expect(page.getByTestId('edit-text-cancel')).toBeVisible();
    await expect(page.getByTestId('edit-text-save')).toBeVisible();

    // Modify and save
    await textarea.fill(EDITED_TEXT);
    await page.getByTestId('edit-text-save').click();

    // Back to read mode, new content visible in the article
    await expect(page.getByTestId('edit-text-textarea')).toHaveCount(0);
    await expect(page.locator('article')).toBeVisible();
    await expect(page.locator('article')).toContainText('maan');
    await expect(page.locator('article')).toContainText('straat');
    await expect(page.locator('article')).not.toContainText('son skyn helder vandag');

    // Persisted in DB
    const lessonId = page.url().split('/').pop()!;
    const checkRes = await page.request.get(`/api/lessons/${lessonId}`);
    const persisted = await checkRes.json();
    expect(persisted.textContent).toBe(EDITED_TEXT);
  });

  test('cancel discards changes and restores the article', async ({ page }) => {
    await page.getByTestId('edit-text-button').click();
    const textarea = page.getByTestId('edit-text-textarea');
    await expect(textarea).toBeVisible();

    await textarea.fill('totally different text that should not persist');
    await page.getByTestId('edit-text-cancel').click();

    // Article restored with original content
    await expect(page.getByTestId('edit-text-textarea')).toHaveCount(0);
    await expect(page.locator('article')).toContainText('vandag');
    await expect(page.locator('article')).not.toContainText('totally different');

    // DB still has the original
    const lessonId = page.url().split('/').pop()!;
    const checkRes = await page.request.get(`/api/lessons/${lessonId}`);
    const persisted = await checkRes.json();
    expect(persisted.textContent).toBe(ORIGINAL_TEXT);
  });

  test('back button is disabled while editing', async ({ page }) => {
    const backButton = page.getByRole('button', { name: /back/i }).first();
    await expect(backButton).toBeEnabled();

    await page.getByTestId('edit-text-button').click();
    await expect(backButton).toBeDisabled();

    await page.getByTestId('edit-text-cancel').click();
    await expect(backButton).toBeEnabled();
  });
});
