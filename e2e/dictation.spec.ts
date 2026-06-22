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

test.describe.serial('Dictation - Correct path (seeded)', () => {
  const TEST_COLLECTION = 'top2000';
  const KNOWN = {
    id: 'test-dictation-known-1',
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

  test('typing the heard sentence exactly scores a perfect dictation and completes the round', async ({
    page,
  }) => {
    // Make the seeded sentence the only review-due one in its collection so the
    // round is deterministic (the round draws due sentences in random order).
    const dueRes = await page.request.get(
      `/api/cloze/due?mode=review&collection=${TEST_COLLECTION}&limit=50`,
    );
    for (const s of await dueRes.json()) {
      await page.request.delete(`/api/cloze/${s.id}`);
    }
    const seedRes = await page.request.post('/api/cloze', { data: [KNOWN] });
    expect(seedRes.ok()).toBeTruthy();

    try {
      await waitForSetup(page);
      await selectDictation(page);

      // Start a one-sentence review round for the seeded collection.
      await page.getByRole('button', { name: /1000-2000\s+\d+ due/ }).click();

      await expect(page.getByText('Type the sentence you hear')).toBeVisible({
        timeout: 10000,
      });
      // The sentence is genuinely hidden — only the audio is presented.
      await expect(page.getByText(KNOWN.sentence)).toHaveCount(0);

      // Type exactly what is spoken.
      await page.getByTestId('dictation-input').fill(KNOWN.sentence);
      await page.getByRole('button', { name: 'Check' }).click();

      // A flawless transcription reads as "Perfect!" at 100%.
      await expect(page.getByRole('heading', { name: 'Perfect!' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId('dictation-accuracy')).toContainText('100% correct');

      // The single, passed sentence completes the round (no retry queue).
      await page.getByRole('button', { name: 'Next Sentence' }).click();
      await expect(page.getByText('Round Complete!')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/1\/1 correct/)).toBeVisible();
    } finally {
      await page.request.delete(`/api/cloze/${KNOWN.id}`);
    }
  });
});
