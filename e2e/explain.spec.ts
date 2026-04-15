import { test, expect, Page } from '@playwright/test';

async function startPracticeRound(page: Page) {
  await page.goto('/practice');
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Fill in the blank')).toBeVisible({
    timeout: 10000,
  });
}

async function getToFeedbackScreen(page: Page) {
  const input = page.locator('input[placeholder="..."]');
  await input.fill('wronganswer');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(
    page.getByRole('heading', { name: 'Incorrect' })
  ).toBeVisible({ timeout: 5000 });
}

test.describe('Explain Feature', () => {
  test('should show Explain button on feedback screen', async ({ page }) => {
    await startPracticeRound(page);
    await getToFeedbackScreen(page);

    await expect(
      page.getByRole('button', { name: 'Explain' })
    ).toBeVisible();
  });

  test('should call /api/explain and display the explanation', async ({
    page,
  }) => {
    // Mock the explain API to avoid needing real Anthropic credentials
    await page.route('**/api/explain', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          explanation:
            'This is a test explanation of the Afrikaans sentence for the language learner.',
        }),
      });
    });

    await startPracticeRound(page);
    await getToFeedbackScreen(page);

    const explainBtn = page.getByRole('button', { name: 'Explain' });
    await explainBtn.click();

    // Should show loading state
    // Then show the explanation text
    await expect(
      page.getByText('This is a test explanation of the Afrikaans sentence')
    ).toBeVisible({ timeout: 10000 });

    // Button should change to "Explained" state
    await expect(page.getByText('Explained')).toBeVisible();
  });

  test('should handle explain API error gracefully', async ({ page }) => {
    await page.route('**/api/explain', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to generate explanation' }),
      });
    });

    await startPracticeRound(page);
    await getToFeedbackScreen(page);

    const explainBtn = page.getByRole('button', { name: 'Explain' });
    await explainBtn.click();

    // Should show error state on button
    await expect(page.getByText('Error')).toBeVisible({ timeout: 5000 });
  });
});
