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

    // Should redirect to setup page
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByText("Welcome to Lector")).toBeVisible();
    await expect(page.getByTestId("setup-language-af")).toBeVisible();
    await expect(page.getByTestId("setup-language-de")).toBeVisible();
    await expect(page.getByTestId("setup-language-es")).toBeVisible();

    // Select Afrikaans
    await page.getByTestId("setup-language-af").click();

    // Should redirect to home after selection
    await expect(page).toHaveURL("/");

    // Restore the setting for other tests
    await page.request.put("/api/settings/targetLanguage", {
      data: { value: "af" },
    });

    await context.close();
  });

  test("should switch language via sidebar selector", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open the language selector
    const selector = page.getByTestId("language-selector").first();
    await expect(selector).toBeVisible();
    await selector.click();

    // Should show language options
    await expect(page.getByTestId("language-option-af")).toBeVisible();
    await expect(page.getByTestId("language-option-de")).toBeVisible();
    await expect(page.getByTestId("language-option-es")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("language-option-af")).not.toBeVisible();
  });

  test("should show compact language selector on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Compact selector should be visible in the mobile top bar
    const selector = page.getByTestId("language-selector");
    await expect(selector).toBeVisible();
    await selector.click();

    // Options should appear
    await expect(page.getByTestId("language-option-af")).toBeVisible();
  });
});
