import { test, expect } from "@playwright/test";

test.describe("Reading Streak", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("home page streak counts a day with dictionary lookups", async ({ page }) => {
    // Make sure today registers as a reading day
    const res = await page.request.put("/api/stats/today", {
      data: { field: "dictionaryLookups", amount: 1 },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const card = page.locator('[data-testid="current-streak"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Streak text reads "N day(s)" with N >= 1
    const text = (await card.textContent()) ?? "";
    const match = text.match(/(\d+)\s+days?/);
    expect(match).not.toBeNull();
    const streakDays = parseInt(match![1], 10);
    expect(streakDays).toBeGreaterThanOrEqual(1);
  });
});
