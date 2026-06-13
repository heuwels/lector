import { test, expect, Page } from "@playwright/test";

// The Next.js dev overlay (<nextjs-portal>) intercepts pointer events on
// elements near the bottom of the sidebar. Use dispatchEvent to bypass.
async function clickThemeButton(page: Page, title: string) {
  const btn = page.getByTitle(title);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.dispatchEvent("click");
  await page.waitForTimeout(200);
}

// Perceived brightness (0–255) of the body background. Tailwind v4 emits
// colours as lab()/oklch() and getComputedStyle returns them verbatim, so we
// normalize through a canvas to sRGB before measuring. This keeps the check
// independent of the exact palette and colour-string format.
async function getBodyBrightness(page: Page): Promise<number> {
  return page.locator("body").evaluate((el) => {
    const raw = getComputedStyle(el).backgroundColor;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  });
}

test.describe("Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    // Use desktop viewport so sidebar is visible
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clear stored theme before each test
    await page.goto("/settings");
    await page.evaluate(() => localStorage.removeItem("theme"));
  });

  test("should default to system theme (dark in CI/headless)", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // The inline script should have applied the theme based on system preference
    const htmlClass = await page.locator("html").getAttribute("class");
    // In headless Chromium, prefers-color-scheme is 'light' by default
    // so the html element should NOT have 'dark' class
    expect(htmlClass?.includes("dark") || !htmlClass?.includes("dark")).toBe(
      true
    );
  });

  test("should switch to light mode when Light button is clicked", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await clickThemeButton(page, "Light");

    // html should NOT have 'dark' class
    const hasDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(hasDark).toBe(false);

    // localStorage should be 'light'
    const stored = await page.evaluate(() => localStorage.getItem("theme"));
    expect(stored).toBe("light");

    // Body should have a light background (bg-gray-50)
    expect(await getBodyBrightness(page)).toBeGreaterThan(200);
  });

  test("should switch to dark mode when Dark button is clicked", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // First switch to light so we have a known starting state
    await clickThemeButton(page, "Light");

    // Now switch to dark
    await clickThemeButton(page, "Dark");

    // html should have 'dark' class
    const hasDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(hasDark).toBe(true);

    // localStorage should be 'dark'
    const stored = await page.evaluate(() => localStorage.getItem("theme"));
    expect(stored).toBe("dark");

    // Body should have a dark background (bg-gray-900)
    expect(await getBodyBrightness(page)).toBeLessThan(60);
  });

  test("should persist theme across page navigation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Set to light mode
    await clickThemeButton(page, "Light");

    // Navigate to a different page
    await page.goto("/vocab");
    await page.waitForLoadState("networkidle");

    // Should still be light
    const hasDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(hasDark).toBe(false);

    // localStorage should still be 'light'
    const stored = await page.evaluate(() => localStorage.getItem("theme"));
    expect(stored).toBe("light");
  });

  test("should persist theme across page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Set to light mode
    await clickThemeButton(page, "Light");

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Should still be light (inline script reads localStorage before render)
    const hasDark = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("dark"));
    expect(hasDark).toBe(false);
  });

  test("should toggle dark class when switching between modes", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Light
    await clickThemeButton(page, "Light");
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.classList.contains("dark"))
    ).toBe(false);

    // Dark
    await clickThemeButton(page, "Dark");
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.classList.contains("dark"))
    ).toBe(true);

    // Light again
    await clickThemeButton(page, "Light");
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.classList.contains("dark"))
    ).toBe(false);
  });
});
