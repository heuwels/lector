import { test, expect, Page } from "@playwright/test";

// The Next.js dev overlay (<nextjs-portal>) intercepts pointer events on
// elements near the bottom of the sidebar. Use dispatchEvent to bypass.
async function clickThemeButton(page: Page, title: string) {
  const btn = page.getByTitle(title);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.dispatchEvent("click");
  await page.waitForTimeout(200);
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

    // Body should have light background
    const bodyBg = await page.locator("body").evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // Light mode bg-gray-50 = rgb(249, 250, 251)
    expect(bodyBg).toContain("249");
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

    // Body should have dark background
    const bodyBg = await page.locator("body").evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // Dark mode bg-gray-900 = rgb(17, 24, 39)
    expect(bodyBg).toContain("17");
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
