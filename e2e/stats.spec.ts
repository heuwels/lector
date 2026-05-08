import { test, expect } from "@playwright/test";

test.describe("Stats Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("should not display the removed Time Reading and Books Read cards", async ({
    page,
  }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });

    await expect(main.getByText("Time Reading")).toHaveCount(0);
    await expect(main.getByText("Books Read")).toHaveCount(0);
    await expect(main.getByText("Total time invested")).toHaveCount(0);
  });

  test("should place Learning (L1-L4) adjacent to Words Known in the top row", async ({
    page,
  }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const topCards = page.locator('[data-testid="stats-top-cards"]');
    await expect(topCards).toBeVisible({ timeout: 10000 });

    const labels = topCards.locator("p.text-zinc-500, p.dark\\:text-zinc-400");
    // Top row should contain Words Known, Learning (L1-L4), and Current Streak
    await expect(topCards.getByText("Words Known")).toBeVisible();
    await expect(topCards.getByText("Learning (L1-L4)")).toBeVisible();
    await expect(topCards.getByText("Current Streak")).toBeVisible();

    // Words Known and Learning (L1-L4) must be neighbours: collect ordered labels
    const orderedLabels = await labels.allInnerTexts();
    const wordsKnownIdx = orderedLabels.indexOf("Words Known");
    const learningIdx = orderedLabels.indexOf("Learning (L1-L4)");
    expect(wordsKnownIdx).toBeGreaterThanOrEqual(0);
    expect(learningIdx).toBeGreaterThanOrEqual(0);
    expect(Math.abs(wordsKnownIdx - learningIdx)).toBe(1);
  });

  test("should render skeleton placeholders before stats load, then swap to real content", async ({
    page,
  }) => {
    // Slow the fluency request so the skeleton has time to appear.
    await page.route("**/api/stats/fluency", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    await page.goto("/stats");

    // Skeleton should be visible during load
    const skeleton = page.locator('[data-testid="stats-skeleton"]');
    await expect(skeleton).toBeVisible({ timeout: 5000 });

    // Eventually the real content takes over and the skeleton goes away
    await page.waitForLoadState("networkidle");
    await expect(skeleton).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('[data-testid="stats-top-cards"]')).toBeVisible();
  });
});
