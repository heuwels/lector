import { test, expect } from "@playwright/test";
import { apiUrl } from './api';

test.describe("Language Setup & Switching", () => {
  test("should redirect to /setup when no language is set", async ({ browser }) => {
    // Create a fresh context with no stored language
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Clear the server-side language setting
    await page.request.delete(apiUrl("/api/settings/targetLanguage"));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should redirect to setup page, client-side (no reload) — SetupGuard
    // must render the page immediately on the router.replace() navigation,
    // not just on a hard load. Regression test for the guard getting stuck
    // on its own spinner forever after a client-side redirect.
    await expect(page).toHaveURL(/\/setup/, { timeout: 15000 });
    const heading = page.getByRole("heading", { name: "Welcome to Lector" });
    await expect(heading).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("setup-language-af")).toBeVisible();
    await expect(page.getByTestId("setup-language-de")).toBeVisible();
    await expect(page.getByTestId("setup-language-es")).toBeVisible();
    await expect(page.getByTestId("setup-language-fr")).toBeVisible();
    await expect(page.getByTestId("setup-language-nl")).toBeVisible();

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
    await expect(page.getByTestId("language-option-fr").first()).toBeVisible();
    await expect(page.getByTestId("language-option-nl").first()).toBeVisible();

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

    // Compact selector in the mobile top bar. At this viewport the desktop
    // sidebar (and its language-selector) is hidden, so target the visible one
    // rather than coupling to the bar's positioning classes (which the layout
    // refactor changed from `fixed top-0` to an in-flow flex child).
    const selector = page.locator('[data-testid="language-selector"]:visible');
    await expect(selector).toBeVisible();
    await selector.click();

    // Options should appear
    await expect(page.getByTestId("language-option-af").first()).toBeVisible();

    await context.close();
  });
});
