import { test, expect } from "@playwright/test";

test.describe("Activity Heatmap", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("renders on stats page with an activity total", async ({ page }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const heatmap = page.locator('[data-testid="activity-heatmap"]');
    await expect(heatmap).toBeVisible({ timeout: 10000 });

    const total = page.locator('[data-testid="activity-heatmap-total"]');
    await expect(total).toBeVisible();
    await expect(total).toHaveText(/^\d[\d,]*\s+actions in the last year$/);
  });

  test("reflects new dictionary lookups after a reload", async ({ page }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const total = page.locator('[data-testid="activity-heatmap-total"]');
    const initialText = (await total.textContent()) ?? "";
    const initialCount = parseInt(initialText.replace(/[^\d]/g, ""), 10) || 0;

    const bump = 3;
    for (let i = 0; i < bump; i++) {
      const res = await page.request.put("/api/stats/today", {
        data: { field: "dictionaryLookups", amount: 1 },
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.reload();
    await page.waitForLoadState("networkidle");

    const updatedText = (await total.textContent()) ?? "";
    const updatedCount = parseInt(updatedText.replace(/[^\d]/g, ""), 10) || 0;
    expect(updatedCount).toBe(initialCount + bump);
  });

  test("counts cloze reviews toward activity (matches the streak definition)", async ({
    page,
  }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const total = page.locator('[data-testid="activity-heatmap-total"]');
    const initialText = (await total.textContent()) ?? "";
    const initialCount = parseInt(initialText.replace(/[^\d]/g, ""), 10) || 0;

    // A cloze-only day keeps a streak alive, so it must register on the heatmap
    // too. Previously the heatmap counted dictionary lookups only.
    const bump = 4;
    for (let i = 0; i < bump; i++) {
      const res = await page.request.put("/api/stats/today", {
        data: { field: "clozePracticed", amount: 1 },
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.reload();
    await page.waitForLoadState("networkidle");

    const updatedText = (await total.textContent()) ?? "";
    const updatedCount = parseInt(updatedText.replace(/[^\d]/g, ""), 10) || 0;
    expect(updatedCount).toBe(initialCount + bump);
  });
});
