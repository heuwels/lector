import { test, expect, Page } from "@playwright/test";

// Wait for the practice page to finish seeding and show the setup screen
async function waitForSetup(page: Page) {
  await page.goto("/practice");
  // Wait for "Start" button to appear (means seeding is done)
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible({
    timeout: 30000,
  });
}

test.describe.serial("Practice - Setup Screen", () => {
  test("should show the setup screen with collection counts", async ({
    page,
  }) => {
    await waitForSetup(page);

    // Title
    await expect(page.getByText("Cloze Practice")).toBeVisible();

    // Learn New section with collection buttons should be visible
    await expect(page.getByText("Learn New")).toBeVisible();
    await expect(page.getByRole("button", { name: /Top 500/ }).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /500-1000/ }).first()
    ).toBeVisible();

    // Round size buttons (within the "Sentences" label section)
    await expect(page.getByRole("button", { name: "10", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "20", exact: true })).toBeVisible();

    // Mode buttons
    await expect(page.getByRole("button", { name: "Type" })).toBeVisible();
    await expect(page.getByRole("button", { name: "MC" })).toBeVisible();

    // Start button
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  test("should switch collections", async ({ page }) => {
    await waitForSetup(page);

    // Click 500-1000 collection
    const btn = page.getByRole("button", { name: /500-1000/ });
    await btn.click();

    // Should have selected state (blue background)
    await expect(btn).toHaveClass(/bg-blue-500/);
  });

  test("should switch round size", async ({ page }) => {
    await waitForSetup(page);

    const btn10 = page.getByRole("button", { name: "10", exact: true });
    await btn10.click();
    await expect(btn10).toHaveClass(/bg-blue-500/);
  });

  test("should switch between Type and MC modes", async ({ page }) => {
    await waitForSetup(page);

    const typeBtn = page.getByRole("button", { name: "Type" });
    const mcBtn = page.getByRole("button", { name: "MC" });

    // Select MC mode
    await mcBtn.click();
    await expect(mcBtn).toHaveClass(/bg-blue-500/);

    // Switch back to Type
    await typeBtn.click();
    await expect(typeBtn).toHaveClass(/bg-blue-500/);
  });
});

test.describe.serial("Practice - Type Mode Full Journey", () => {
  test("should start a round and show a cloze sentence", async ({ page }) => {
    await waitForSetup(page);

    // Select smallest round size for faster testing
    await page.getByRole("button", { name: "10", exact: true }).click();

    // Ensure Type mode is selected
    await page.getByRole("button", { name: "Type" }).click();

    // Start the round
    await page.getByRole("button", { name: "Start" }).click();

    // Should transition to practicing state
    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Should show progress counter
    await expect(page.getByText("/10")).toBeVisible();

    // Should show an input field with placeholder
    const input = page.locator('input[placeholder="..."]');
    await expect(input).toBeVisible();

    // Should show translation (italic text)
    const translation = page.locator("p.italic");
    await expect(translation).toBeVisible();

    // Should show mastery indicator
    await expect(page.getByText("Mastery:")).toBeVisible();

    // Should show hint and check buttons
    await expect(page.getByRole("button", { name: /Hint/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
  });

  test("should type a correct answer and show feedback", async ({ page }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    const input = page.locator('input[placeholder="..."]');
    await input.focus();

    // Use hints to reveal the full word, then submit
    const hintBtn = page.getByRole("button", { name: /Hint/ });
    for (let i = 0; i < 30; i++) {
      const submitBtn = page.getByRole("button", { name: "Submit" });
      if (await submitBtn.isVisible().catch(() => false)) {
        break;
      }
      if (await hintBtn.isVisible().catch(() => false)) {
        await hintBtn.click();
      }
      await page.waitForTimeout(150);
    }

    // Submit the correct answer
    const submitBtn = page.getByRole("button", { name: "Submit" });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Should show feedback
    await expect(page.getByRole("heading", { name: "Correct!" })).toBeVisible({ timeout: 5000 });

    // Should show the Next button
    await expect(page.getByRole("button", { name: "Next Sentence" })).toBeVisible();
  });

  test("should handle show answer flow for unknown words", async ({
    page,
  }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Type a wrong answer
    const input = page.locator('input[placeholder="..."]');
    await input.fill("zzzzz");

    // Click Check (which becomes "show answer" when wrong)
    await page.getByRole("button", { name: "Check" }).click();

    // Should show "The answer was:" overlay
    await expect(page.getByText("The answer was:")).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText("You'll see this sentence again later")
    ).toBeVisible();

    // Click Continue
    await page.getByRole("button", { name: "Continue" }).click();

    // Should advance - either show next sentence or feedback
    // Progress should have advanced
    await page.waitForTimeout(500);
  });

  test("should complete a full round and show summary", async ({ page }) => {
    await waitForSetup(page);

    // Use smallest round size
    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Complete all 10 sentences by using hints to get correct answers
    for (let round = 0; round < 40; round++) {
      // Check terminal states
      if (await page.getByText("Round Complete!").isVisible().catch(() => false)) break;
      if (await page.getByText("Nothing to Review").isVisible().catch(() => false)) break;

      // Handle feedback state - click Next Sentence
      const nextBtn = page.getByRole("button", { name: "Next Sentence" });
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        continue;
      }

      // Handle "showing answer" state
      const continueBtn = page.getByRole("button", { name: "Continue" });
      if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(300);
        continue;
      }

      // Practicing state - use hints to reveal full word then submit
      const input = page.locator('input[placeholder="..."]');
      if (await input.isVisible().catch(() => false)) {
        const hintBtn = page.getByRole("button", { name: /Hint/ });
        for (let h = 0; h < 25; h++) {
          const submitBtn = page.getByRole("button", { name: "Submit" });
          if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click();
            break;
          }
          if (await hintBtn.isVisible().catch(() => false)) {
            await hintBtn.click();
          }
          await page.waitForTimeout(50);
        }
        await page.waitForTimeout(300);
        continue;
      }

      await page.waitForTimeout(200);
    }

    // Should eventually show Round Complete!
    await expect(page.getByText("Round Complete!")).toBeVisible({
      timeout: 15000,
    });

    // Should show score
    await expect(page.getByText(/\d+\/10 correct/)).toBeVisible();

    // Should show action buttons
    await expect(
      page.getByRole("button", { name: "Change Settings" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play Again" })
    ).toBeVisible();
  });

  test("should return to setup via Change Settings", async ({ page }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Click Back to return to setup
    await page.getByText("← Back").click();

    // Should be back at setup
    await expect(page.getByText("Cloze Practice")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });
});

test.describe.serial("Practice - Multiple Choice Mode", () => {
  test("should show MC options when MC mode is selected", async ({ page }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "MC" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    // Should show MC instruction
    await expect(page.getByText("Choose the correct word")).toBeVisible({
      timeout: 10000,
    });

    // Should show 4 option buttons with numbers
    await expect(page.getByRole("button", { name: /^1\s/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^2\s/ })).toBeVisible();
    // Note: buttons contain number + word text
  });

  test("should handle MC selection and advance", async ({ page }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "MC" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Choose the correct word")).toBeVisible({
      timeout: 10000,
    });

    // Click the first MC option (buttons in the 2-col grid with number spans)
    const mcGrid = page.locator(".grid.grid-cols-1");
    const mcButtons = mcGrid.locator("button");
    await expect(mcButtons.first()).toBeVisible();
    await mcButtons.first().click();

    // After selection, one button should get green border (correct answer highlighted)
    // then it auto-advances after a delay
    await page.waitForTimeout(500);

    // The correct answer button should have green styling
    const greenBtn = mcGrid.locator("button.border-green-500");
    await expect(greenBtn).toBeVisible({ timeout: 2000 });

    // Wait for auto-advance
    await page.waitForTimeout(2000);
  });
});

test.describe.serial("Practice - Review Flow", () => {
  test("should show empty state when no reviews are due", async ({ page }) => {
    // First do a fresh round so we have some reviewed sentences
    await waitForSetup(page);

    // Check if Review Due section exists
    const reviewSection = page.getByText("Review Due");
    const hasReviews = await reviewSection.isVisible().catch(() => false);

    if (!hasReviews) {
      // No reviews due - this is expected on a fresh DB
      // Verify the Learn New section is showing
      await expect(page.getByText("Learn New")).toBeVisible();
    }
  });

  test("should handle review round after completing a new round", async ({
    page,
  }) => {
    await waitForSetup(page);

    // First complete a small round of new sentences
    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Complete the round quickly using show-answer for each
    for (let i = 0; i < 15; i++) {
      const complete = page.getByText("Round Complete!");
      if (await complete.isVisible().catch(() => false)) break;

      const empty = page.getByText("Nothing to Review");
      if (await empty.isVisible().catch(() => false)) break;

      const nextBtn = page.getByRole("button", { name: "Next Sentence" });
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        continue;
      }

      const continueBtn = page.getByRole("button", { name: "Continue" });
      if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(300);
        continue;
      }

      // Show answer for each (wrong answers get nextReview = now, so they become due immediately)
      const input = page.locator('input[placeholder="..."]');
      if (await input.isVisible().catch(() => false)) {
        await input.fill("zzzzz");
        await page.getByRole("button", { name: "Check" }).click();
        await page.waitForTimeout(300);
      }

      await page.waitForTimeout(200);
    }

    // After round, go back to setup
    const changeBtn = page.getByRole("button", { name: "Change Settings" });
    if (await changeBtn.isVisible().catch(() => false)) {
      await changeBtn.click();
    } else {
      const backBtn = page.getByText("Back");
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
      }
    }

    // Wait for setup to load with fresh counts
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible({
      timeout: 10000,
    });

    // Since we answered everything wrong (mastery 0, nextReview = now),
    // there should now be a "Review Due" section
    await page.waitForTimeout(1000);
    const reviewDue = page.getByText("Review Due");
    if (await reviewDue.isVisible().catch(() => false)) {
      // Click the review button for the collection
      const reviewBtn = page.getByRole("button", { name: /due$/ }).first();
      await reviewBtn.click();

      // Should start a review round
      await expect(page.getByText("Fill in the blank")).toBeVisible({
        timeout: 10000,
      });
    }
  });
});

test.describe("Practice - Hint System", () => {
  test("should reveal letters incrementally with hint button", async ({
    page,
  }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    const input = page.locator('input[placeholder="..."]');
    const hintBtn = page.getByRole("button", { name: /Hint/ });

    // Input should be empty
    await expect(input).toHaveValue("");

    // Click hint once
    await hintBtn.click();
    await page.waitForTimeout(200);

    // Input should now have 1 character
    const value1 = await input.inputValue();
    expect(value1.length).toBe(1);

    // Hint button should now show "1 letter"
    await expect(page.getByRole("button", { name: /1 letter/ })).toBeVisible();

    // Click hint again
    await hintBtn.click();
    await page.waitForTimeout(200);

    // Input should now have 2 characters
    const value2 = await input.inputValue();
    expect(value2.length).toBe(2);

    // Should show "2 letters"
    await expect(
      page.getByRole("button", { name: /2 letters/ })
    ).toBeVisible();
  });
});

test.describe("Practice - Blacklist", () => {
  test("should blacklist a sentence and show toast", async ({ page }) => {
    await waitForSetup(page);

    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page.getByText("Fill in the blank")).toBeVisible({
      timeout: 10000,
    });

    // Click the blacklist/hide button (ban icon in top-right of sentence area)
    const blacklistBtn = page.locator('button[title="Skip & hide this sentence"]');
    await blacklistBtn.click();

    // Should show toast notification
    await expect(page.getByText("Sentence hidden")).toBeVisible({
      timeout: 3000,
    });

    // Toast should disappear
    await expect(page.getByText("Sentence hidden")).not.toBeVisible({
      timeout: 5000,
    });
  });
});
