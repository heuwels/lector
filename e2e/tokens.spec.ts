import { test, expect } from "@playwright/test";

test.describe("API Tokens", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any existing test tokens via API
    const res = await page.request.get("/api/tokens");
    const tokens = await res.json();
    for (const t of tokens) {
      if (t.name.startsWith("Test") || t.name.startsWith("E2E")) {
        await page.request.delete(`/api/tokens/${t.id}`);
      }
    }
  });

  test("should create a token, show it once, and list it", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Scroll to API Tokens section
    const section = page.getByText("API Tokens");
    await expect(section.first()).toBeVisible();

    // Click Generate Token
    await page.getByRole("button", { name: "Generate Token" }).click();

    // Fill in name
    await page.getByPlaceholder("e.g. CLI, Automation, Backup script").fill("Test Token");

    // Full Access should be checked by default
    const fullAccessCheckbox = page.locator("label").filter({ hasText: "Full Access" }).locator("input[type='checkbox']");
    await expect(fullAccessCheckbox).toBeChecked();

    // Click Create Token
    await page.getByRole("button", { name: "Create Token" }).click();

    // Should show the one-time token display
    await expect(
      page.getByText("Copy this token now")
    ).toBeVisible();

    // Token should start with ltr_
    const tokenCode = page.locator("code").filter({ hasText: /^ltr_/ });
    const tokenText = await tokenCode.textContent();
    expect(tokenText).toMatch(/^ltr_/);

    // Click "I've saved this token"
    await page.getByText("I've saved this token").click();

    // One-time display should be gone
    await expect(
      page.getByText("Copy this token now")
    ).not.toBeVisible();

    // Token should appear in the list
    await expect(page.getByText("Test Token")).toBeVisible();
    await expect(page.getByText("Full Access")).toBeVisible();
  });

  test("should create a scoped token", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Generate Token" }).click();
    await page.getByPlaceholder("e.g. CLI, Automation, Backup script").fill("E2E Scoped");

    // Uncheck Full Access
    const fullAccessLabel = page.locator("label").filter({ hasText: "Full Access" });
    await fullAccessLabel.click();

    // Check specific scopes
    await page.locator("label").filter({ hasText: "Collections (read)" }).click();
    await page.locator("label").filter({ hasText: "Stats (read)" }).click();

    await page.getByRole("button", { name: "Create Token" }).click();

    // Verify token is shown
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await page.getByText("I've saved this token").click();

    // Verify scope badges
    await expect(page.getByText("collections:read")).toBeVisible();
    await expect(page.getByText("stats:read")).toBeVisible();
  });

  test("should revoke a token", async ({ page }) => {
    // Create a token via API first
    await page.request.post("/api/tokens", {
      data: { name: "Test Revoke", scopes: ["*"] },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Token should be listed
    await expect(page.getByText("Test Revoke")).toBeVisible();

    // Click Revoke and accept confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());
    const tokenRow = page.locator("div").filter({ hasText: "Test Revoke" }).first();
    await tokenRow.getByRole("button", { name: "Revoke" }).click();

    // Token should be gone
    await expect(page.getByText("Test Revoke")).not.toBeVisible();
  });

  test("should disable Create button when name is empty", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Generate Token" }).click();

    // Create Token button should be disabled when name is empty
    const createBtn = page.getByRole("button", { name: "Create Token" });
    await expect(createBtn).toBeDisabled();

    // Fill in name - button should become enabled
    await page.getByPlaceholder("e.g. CLI, Automation, Backup script").fill("Test");
    await expect(createBtn).toBeEnabled();

    // Clear name - button should be disabled again
    await page.getByPlaceholder("e.g. CLI, Automation, Backup script").fill("");
    await expect(createBtn).toBeDisabled();
  });
});
