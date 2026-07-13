import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiUrl } from './api';

const COLLECTION_ID = 'takeout-e2e-collection';
const LESSON_ID = 'takeout-e2e-lesson';
const TS = '2026-01-01T00:00:00Z';

async function cleanup(page: Page) {
  await page.request.delete(apiUrl(`/api/collections/${COLLECTION_ID}`));
}

test.describe('learning-data takeout', () => {
  test.beforeEach(async ({ page }) => cleanup(page));
  test.afterEach(async ({ page }) => cleanup(page));

  test('downloads from Settings and imports into the self-hosted app', async ({ page }) => {
    const seeded = await page.request.post(apiUrl('/api/data'), {
      data: {
        format: 'lector-learning-data',
        version: 1,
        exportedAt: TS,
        collections: [
          {
            id: COLLECTION_ID,
            title: 'Takeout test reader',
            author: 'Reader',
            language: 'af',
            createdAt: TS,
            lastReadAt: TS,
          },
        ],
        lessons: [
          {
            id: LESSON_ID,
            collectionId: COLLECTION_ID,
            title: 'Takeout test lesson',
            textContent: 'Ek lees.',
            progress_scrollPosition: 321,
            progress_percentComplete: 64,
            language: 'af',
            createdAt: TS,
            lastReadAt: TS,
          },
        ],
      },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();

    await page.goto('/settings');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-learning-data').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^lector-learning-data-\d{4}-\d{2}-\d{2}\.json$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const takeout = JSON.parse(readFileSync(downloadPath!, 'utf8')) as {
      format: string;
      version: number;
      collections: Array<{ id: string }>;
      lessons: Array<{
        id: string;
        progress_scrollPosition: number;
        progress_percentComplete: number;
      }>;
    };
    expect(takeout).toMatchObject({ format: 'lector-learning-data', version: 1 });
    expect(takeout.collections.map((collection) => collection.id)).toContain(COLLECTION_ID);
    expect(takeout.lessons).toContainEqual(
      expect.objectContaining({
        id: LESSON_ID,
        progress_scrollPosition: 321,
        progress_percentComplete: 64,
      }),
    );

    await cleanup(page);
    await page.getByTestId('import-learning-data').setInputFiles(downloadPath!);
    await expect(page.getByText('Learning data imported')).toBeVisible();

    const restored = await page.request.get(apiUrl(`/api/lessons/${LESSON_ID}`));
    expect(restored.status()).toBe(200);
    expect(await restored.json()).toMatchObject({
      progress_scrollPosition: 321,
      progress_percentComplete: 64,
    });
  });

  test('shows an error for a malformed takeout file', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('import-learning-data').setInputFiles({
      name: 'not-a-takeout.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json'),
    });
    await expect(page.getByText(/Import failed:/)).toBeVisible();
  });
});
