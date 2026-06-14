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

    const labels = topCards.locator("p.text-muted-foreground");
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

  test("fluency badge and top cards show the same known/learning counts", async ({
    page,
  }) => {
    // Seed word states through the same API the reader uses, so the counts
    // are non-zero and both displays have something real to disagree about.
    const seedRes = await page.request.post("/api/known-words", {
      data: {
        updates: [
          { word: "e2e-stats-agree-one", state: "known" },
          { word: "e2e-stats-agree-two", state: "known" },
          { word: "e2e-stats-agree-three", state: "level2" },
        ],
        language: "af",
      },
    });
    expect(seedRes.ok()).toBeTruthy();

    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const badgeKnown = page.locator('[data-testid="fluency-known-count"]');
    const badgeLearning = page.locator('[data-testid="fluency-learning-count"]');
    await expect(badgeKnown).toBeVisible({ timeout: 10000 });

    const topCards = page.locator('[data-testid="stats-top-cards"]');
    const knownCardValue = topCards
      .locator("div.panel", { hasText: "Words Known" })
      .locator("p.text-4xl");
    const learningCardValue = topCards
      .locator("div.panel", { hasText: "Learning (L1-L4)" })
      .locator("p.text-4xl");

    // Both displays must agree, and reflect at least the seeded words
    const badgeKnownText = (await badgeKnown.innerText()).trim();
    const badgeLearningText = (await badgeLearning.innerText()).trim();
    expect((await knownCardValue.innerText()).trim()).toBe(badgeKnownText);
    expect((await learningCardValue.innerText()).trim()).toBe(badgeLearningText);

    const parseCount = (s: string) => parseInt(s.replace(/,/g, ""), 10);
    expect(parseCount(badgeKnownText)).toBeGreaterThanOrEqual(2);
    expect(parseCount(badgeLearningText)).toBeGreaterThanOrEqual(1);
  });

  test("should render skeleton placeholders before stats load, then swap to real content", async ({
    page,
  }) => {
    // Hold the fluency response open until the skeleton has been asserted, so
    // the check is deterministic instead of racing a fixed delay.
    let releaseFluency: () => void = () => {};
    const fluencyGate = new Promise<void>((resolve) => {
      releaseFluency = resolve;
    });
    // Match the query string too: the request is /api/stats/fluency?language=af,
    // so a bare "**/api/stats/fluency" glob never intercepts it.
    await page.route("**/api/stats/fluency*", async (route) => {
      await fluencyGate;
      await route.continue();
    });

    await page.goto("/stats", { waitUntil: "commit" });

    // Skeleton is shown while stats are still loading.
    const skeleton = page.locator('[data-testid="stats-skeleton"]');
    await expect(skeleton).toBeVisible({ timeout: 10000 });

    // Release the data; the real content takes over and the skeleton goes away.
    releaseFluency();
    await page.waitForLoadState("networkidle");
    await expect(skeleton).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('[data-testid="stats-top-cards"]')).toBeVisible();
  });

  test("shows an estimated Words Read card in the top row", async ({ page }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const topCards = page.locator('[data-testid="stats-top-cards"]');
    await expect(topCards).toBeVisible({ timeout: 10000 });

    await expect(topCards.getByText("Words Read", { exact: true })).toBeVisible();
    // The caveat must be visible so the estimate isn't read as a precise count.
    await expect(topCards.getByText("Estimated from reading position")).toBeVisible();
  });

  test("vocab growth range selector defaults to 1y and toggles", async ({
    page,
  }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const selector = page.locator('[data-testid="stats-range-selector"]');
    await expect(selector).toBeVisible({ timeout: 10000 });

    const oneYear = selector.getByRole("button", { name: "1y" });
    const all = selector.getByRole("button", { name: "All" });

    await expect(oneYear).toHaveAttribute("aria-pressed", "true");
    await expect(all).toHaveAttribute("aria-pressed", "false");

    await all.click();

    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(oneYear).toHaveAttribute("aria-pressed", "false");
  });
});
