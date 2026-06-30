import { test, expect } from "@playwright/test";

// Anki integration on the stats page: the dedicated "Anki Reviews" card (with a
// blurred Connect-your-Anki preview when no reviews are synced) plus the
// fold-in of Anki review-days into the activity heatmap.
//
// These tests run with no AnkiConnect available (the CI case). When a real Anki
// IS reachable (local dev), the stats-page sync would write/overwrite
// dailyStats.ankiReviews, so the data-dependent assertions skip themselves.
test.describe("Anki stats", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("shows the Connect-your-Anki preview when no reviews are synced", async ({
    page,
  }) => {
    const sync = await page.request.post("http://localhost:3457/api/anki/sync-reviews");
    const syncBody = await sync.json();
    test.skip(syncBody.connected === true, "live Anki would populate review data");

    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    const card = page.locator('[data-testid="anki-reviews-card"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // Blurred placeholder + call-to-action, not the real chart.
    await expect(page.locator('[data-testid="anki-reviews-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="anki-reviews-chart"]')).toHaveCount(0);
    await expect(
      page.getByText("Connect your Anki to see your review history"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect Anki" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("shows the review chart and counts Anki toward the heatmap once synced", async ({
    page,
  }) => {
    const sync = await page.request.post("http://localhost:3457/api/anki/sync-reviews");
    const syncBody = await sync.json();
    test.skip(syncBody.connected === true, "live Anki would overwrite the seeded count");

    await page.goto("/stats");
    await page.waitForLoadState("networkidle");

    // Activity heatmap total before seeding — Anki reviews fold into it.
    const total = page.locator('[data-testid="activity-heatmap-total"]');
    const initialText = (await total.textContent()) ?? "";
    const initialCount = parseInt(initialText.replace(/[^\d]/g, ""), 10) || 0;

    // Seed today's Anki reviews the same way the other activity tests seed —
    // dailyStats.ankiReviews is in the today-incrementer's allow-list.
    const bump = 5;
    for (let i = 0; i < bump; i++) {
      const res = await page.request.put("http://localhost:3457/api/stats/today", {
        data: { field: "ankiReviews", amount: 1 },
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.reload();
    await page.waitForLoadState("networkidle");

    // The card flips from preview to the real chart...
    await expect(page.locator('[data-testid="anki-reviews-chart"]')).toBeVisible();
    await expect(page.locator('[data-testid="anki-reviews-preview"]')).toHaveCount(0);

    // ...and the reviews count toward the activity heatmap (fold-in).
    const updatedText = (await total.textContent()) ?? "";
    const updatedCount = parseInt(updatedText.replace(/[^\d]/g, ""), 10) || 0;
    expect(updatedCount).toBe(initialCount + bump);
  });

  test("sync-reviews endpoint degrades gracefully (never errors the page)", async ({
    page,
  }) => {
    // The stats page calls this on every load. Whether or not Anki is running it
    // must return 200 with a well-formed body — a 500 here would break stats.
    const res = await page.request.post("http://localhost:3457/api/anki/sync-reviews");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.connected).toBe("boolean");
    expect(typeof body.synced).toBe("number");
    // When Anki is unreachable (the CI case) nothing is written.
    if (body.connected === false) {
      expect(body.synced).toBe(0);
    }
  });
});
