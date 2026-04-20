import { test, expect } from "@playwright/test";

test.describe("Fluency Benchmarks", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("should display fluency section on stats page with level badge", async ({
    page,
  }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    // Fluency section should be visible
    const section = page.locator('[data-testid="fluency-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // Level badge should show A1 for empty/fresh database
    const badge = page.locator('[data-testid="fluency-level-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("A1");

    // Should display the level description
    await expect(section.getByText("Beginner")).toBeVisible();

    // Progress bar should exist
    const progressBar = page.locator('[data-testid="fluency-progress-bar"]');
    await expect(progressBar).toBeVisible();

    // Known and learning counts should be visible
    const knownCount = page.locator('[data-testid="fluency-known-count"]');
    await expect(knownCount).toBeVisible();
    await expect(knownCount).toHaveText("0");

    const learningCount = page.locator('[data-testid="fluency-learning-count"]');
    await expect(learningCount).toBeVisible();
    await expect(learningCount).toHaveText("0");
  });

  test("should show CEFR level label with description", async ({ page }) => {
    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const section = page.locator('[data-testid="fluency-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // Should show "A1 — Beginner" text
    await expect(section.getByText(/A1\s*—\s*Beginner/)).toBeVisible();

    // Should show "Estimated CEFR Level" subtitle
    await expect(section.getByText("Estimated CEFR Level")).toBeVisible();
  });

  test("fluency API endpoint should return valid data", async ({ page }) => {
    const response = await page.request.get("/api/stats/fluency");
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("totalKnownWords");
    expect(data).toHaveProperty("totalLearning");
    expect(data).toHaveProperty("totalNew");
    expect(data).toHaveProperty("estimatedLevel");
    expect(data.estimatedLevel).toHaveProperty("code");
    expect(data.estimatedLevel).toHaveProperty("label");
    expect(data).toHaveProperty("progressToNextLevel");
    expect(data).toHaveProperty("weeklyGrowth");
    expect(data.weeklyGrowth).toHaveProperty("thisWeek");
    expect(data.weeklyGrowth).toHaveProperty("lastWeek");
    expect(data.weeklyGrowth).toHaveProperty("delta");

    // With empty DB, should be A1
    expect(data.estimatedLevel.code).toBe("A1");
    expect(data.totalKnownWords).toBe(0);
    expect(typeof data.progressToNextLevel).toBe("number");
  });
});
