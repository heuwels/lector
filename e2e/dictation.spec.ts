import { test, expect, Page } from '@playwright/test';

// Wait for the practice page to finish seeding and show the setup screen.
async function waitForSetup(page: Page) {
  await page.goto('/practice');
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible({
    timeout: 30000,
  });
}

// Switch the setup screen into Dictation format.
async function selectDictation(page: Page) {
  await page.getByRole('button', { name: /^Dictation/ }).click();
  await expect(page.getByText('Dictation Practice')).toBeVisible();
}

test.describe.serial('Dictation - Setup', () => {
  test('format toggle switches to dictation and hides the Type/MC modes', async ({ page }) => {
    await waitForSetup(page);

    // Both formats are offered, defaulting to Cloze (with Type/MC modes).
    await expect(page.getByRole('button', { name: /^Cloze/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Dictation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Type', exact: true })).toBeVisible();

    // Switch to dictation.
    await selectDictation(page);

    // Type/MC are cloze-only and disappear.
    await expect(page.getByRole('button', { name: 'Type', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'MC', exact: true })).toHaveCount(0);

    // The shared sentence-grouping options stay available.
    await expect(page.getByRole('button', { name: /Top 500/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '10', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
  });
});

test.describe.serial('Dictation - Round', () => {
  test('hides the sentence and shows the audio controls', async ({ page }) => {
    await waitForSetup(page);
    await selectDictation(page);
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByText('Type the sentence you hear')).toBeVisible({
      timeout: 10000,
    });

    // Audio controls: replay + speed.
    await expect(page.getByRole('button', { name: /Listen Again/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '1x', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '0.75x', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '0.5x', exact: true })).toBeVisible();

    // Full-sentence input is present; the cloze blank UI is not.
    await expect(page.getByTestId('dictation-input')).toBeVisible();
    await expect(page.getByText('Fill in the blank')).toHaveCount(0);

    // The sentence is hidden until the user answers.
    await expect(page.getByTestId('dictation-actual')).toHaveCount(0);
  });

  test('caps Listen Again at 3 replays', async ({ page }) => {
    await waitForSetup(page);
    await selectDictation(page);
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByText('Type the sentence you hear')).toBeVisible({
      timeout: 10000,
    });

    // The initial autoplay is free; three explicit replays are allowed.
    const replay = page.getByRole('button', { name: /Listen Again/ });
    for (let i = 0; i < 3; i++) {
      await expect(replay).toBeEnabled();
      await replay.click();
      await page.waitForTimeout(100);
    }

    // After the budget is spent the control locks.
    const locked = page.getByRole('button', { name: /No replays left/ });
    await expect(locked).toBeVisible();
    await expect(locked).toBeDisabled();
  });

  test('a wrong answer reveals the sentence and the word-level diff', async ({ page }) => {
    await waitForSetup(page);
    await selectDictation(page);
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByText('Type the sentence you hear')).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('dictation-input').fill('xxxxx qqqqq');
    await page.getByRole('button', { name: 'Check' }).click();

    // Incorrect feedback with accuracy and the now-revealed sentence.
    await expect(page.getByRole('heading', { name: 'Incorrect' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('dictation-accuracy')).toContainText('% correct');
    await expect(page.getByTestId('dictation-actual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Sentence' })).toBeVisible();
  });

  test('Surrender reveals the answer without typing', async ({ page }) => {
    await waitForSetup(page);
    await selectDictation(page);
    await page.getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Start' }).click();

    await expect(page.getByText('Type the sentence you hear')).toBeVisible({
      timeout: 10000,
    });

    // Give up without typing anything.
    await page.getByRole('button', { name: 'Surrender' }).click();

    // The answer is revealed under a neutral "Answer revealed" heading.
    await expect(page.getByRole('heading', { name: 'Answer revealed' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId('dictation-actual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Sentence' })).toBeVisible();
  });
});

test.describe.serial('Dictation - Cloze review reminders hidden (#191)', () => {
  const TEST_COLLECTION = 'top2000';
  // A review-due card (reviewCount > 0, nextReview in the past) so the cloze
  // "Review Due" reminder actually renders. Dictation must hide that reminder:
  // it's a focused listening drill, and the SRS review prompts are a cloze
  // concern (issue #191).
  const DUE = {
    id: 'test-dictation-review-hidden-1',
    sentence: 'Die bruin hond hardloop vinnig.',
    clozeWord: 'hardloop',
    clozeIndex: 3,
    translation: 'The brown dog runs fast.',
    source: 'tatoeba',
    collection: TEST_COLLECTION,
    masteryLevel: 25,
    nextReview: '2020-01-01T00:00:00.000Z',
    reviewCount: 3,
    timesCorrect: 2,
    timesIncorrect: 1,
  };

  test('shows the Review Due reminder in cloze and hides it in dictation', async ({ page }) => {
    // Make the seeded card the only review-due one in this collection so the
    // "1000-2000 N due" entry is deterministic.
    const dueRes = await page.request.get(
      `http://localhost:3457/api/cloze/due?mode=review&collection=${TEST_COLLECTION}&limit=50`,
    );
    for (const s of await dueRes.json()) {
      await page.request.delete(`http://localhost:3457/api/cloze/${s.id}`);
    }
    const seedRes = await page.request.post('http://localhost:3457/api/cloze', { data: [DUE] });
    expect(seedRes.ok()).toBeTruthy();

    const reviewHeading = page.getByRole('heading', { name: /Review Due/ });
    const reviewDueButton = page.getByRole('button', { name: /1000-2000\s+\d+ due/ });

    try {
      await waitForSetup(page);

      // Cloze (the default format) surfaces the SRS review reminder.
      await expect(reviewHeading).toBeVisible();
      await expect(reviewDueButton).toBeVisible();

      // Switching to dictation hides the cloze review reminders entirely…
      await selectDictation(page);
      await expect(reviewHeading).toHaveCount(0);
      await expect(reviewDueButton).toHaveCount(0);
      // …while the Learn New flow stays available.
      await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();

      // Switching back to cloze restores the reminder.
      await page.getByRole('button', { name: 'Cloze', exact: true }).click();
      await expect(reviewHeading).toBeVisible();
      await expect(reviewDueButton).toBeVisible();
    } finally {
      await page.request.delete(`http://localhost:3457/api/cloze/${DUE.id}`);
    }
  });
});
