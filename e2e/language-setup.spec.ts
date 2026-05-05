import { test, expect } from "@playwright/test";

test.describe("Language Setup & Switching", () => {
  test("should redirect to /setup when no language is set", async ({ browser }) => {
    // Create a fresh context with no stored language
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Clear the server-side language setting
    await page.request.delete("/api/settings/targetLanguage");

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should redirect to setup page
    await expect(page).toHaveURL(/\/setup/, { timeout: 15000 });

    // Wait for the setup page to render — may need a reload since the
    // SetupGuard client-side redirect lands on /setup but the initial
    // page shell might still be from / (Next.js client nav)
    await page.waitForLoadState("networkidle");
    const heading = page.getByRole("heading", { name: "Welcome to Lector" });
    // If heading not visible yet, the SetupGuard may have shown spinner then redirected;
    // give the client router time to render the setup page
    if (!(await heading.isVisible())) {
      await page.waitForTimeout(1000);
      await page.reload();
      await page.waitForLoadState("networkidle");
    }
    await expect(heading).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("setup-language-af")).toBeVisible();
    await expect(page.getByTestId("setup-language-de")).toBeVisible();
    await expect(page.getByTestId("setup-language-es")).toBeVisible();

    // Select Afrikaans
    await page.getByTestId("setup-language-af").click();

    // Should redirect to home after selection
    await expect(page).toHaveURL("/", { timeout: 15000 });

    await context.close();
  });

  test("should switch language via sidebar selector", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Desktop sidebar selector (scope to sidebar to avoid the hidden mobile one)
    const sidebar = page.locator("aside");
    const selector = sidebar.getByTestId("language-selector");
    await expect(selector).toBeVisible();
    await selector.click();

    // Should show language options
    await expect(page.getByTestId("language-option-af").first()).toBeVisible();
    await expect(page.getByTestId("language-option-de").first()).toBeVisible();
    await expect(page.getByTestId("language-option-es").first()).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("language-option-af").first()).not.toBeVisible();
  });

  test("should show compact language selector on mobile", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      storageState: {
        cookies: [],
        origins: [
          {
            origin: "http://localhost:3456",
            localStorage: [{ name: "lector-target-language", value: "af" }],
          },
        ],
      },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Compact selector in the mobile top bar (scope to the fixed top bar)
    const topbar = page.locator("div.fixed.top-0");
    const selector = topbar.getByTestId("language-selector");
    await expect(selector).toBeVisible();
    await selector.click();

    // Options should appear
    await expect(page.getByTestId("language-option-af").first()).toBeVisible();

    await context.close();
  });
});
