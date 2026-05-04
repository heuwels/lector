import { test, expect } from "@playwright/test";

test.describe("Anthropic Credential Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any existing credentials
    await page.request.delete("/api/settings/anthropicApiKey");
    await page.request.delete("/api/settings/claudeOauthToken");
    await page.request.delete("/api/settings/anthropicAuthMode");
    // Set provider to anthropic so the credential UI shows
    await page.request.put("/api/settings/llmProvider", {
      data: { value: "anthropic" },
    });
  });

  test("should not leak credentials in GET /api/settings", async ({
    page,
  }) => {
    // Set a credential via PUT
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-test-secret-key" },
    });

    // GET all settings should return true, not the actual key
    const res = await page.request.get("/api/settings");
    const settings = await res.json();
    expect(settings.anthropicApiKey).toBe(true);

    // GET individual setting should also return true
    const res2 = await page.request.get("/api/settings/anthropicApiKey");
    const value = await res2.json();
    expect(value).toBe(true);
  });

  test("should show input when no API key is configured", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Should show the API key input (not "Configured")
    await expect(
      page.getByPlaceholder("sk-ant-api...")
    ).toBeVisible();
    await expect(page.getByText("Configured").first()).not.toBeVisible();
  });

  test("should show Configured badge after saving API key", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Type a key and save
    await page.getByPlaceholder("sk-ant-api...").fill("sk-ant-api-test-key");
    await page.getByRole("button", { name: "Save" }).first().click();

    // Should now show Configured badge
    await expect(page.getByText("Configured").first()).toBeVisible();

    // Should show Replace and Clear buttons
    await expect(
      page.getByRole("button", { name: "Replace" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Clear" }).first()
    ).toBeVisible();

    // Input should be gone
    await expect(page.getByPlaceholder("sk-ant-api...")).not.toBeVisible();
  });

  test("should clear a configured API key", async ({ page }) => {
    // Pre-set a key
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-to-clear" },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Should show Configured
    await expect(page.getByText("Configured").first()).toBeVisible();

    // Click Clear
    await page.getByRole("button", { name: "Clear" }).first().click();

    // Should show input again
    await expect(page.getByPlaceholder("sk-ant-api...")).toBeVisible();
    await expect(page.getByText("Configured").first()).not.toBeVisible();
  });

  test("should show Replace flow for configured API key", async ({
    page,
  }) => {
    // Pre-set a key
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-original" },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Click Replace
    await page.getByRole("button", { name: "Replace" }).first().click();

    // Should show input with Save and Cancel
    await expect(page.getByPlaceholder("sk-ant-api...")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel" }).first()
    ).toBeVisible();

    // Cancel should go back to Configured
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(page.getByText("Configured").first()).toBeVisible();
  });

  test("should NOT show auth mode toggle when only one credential is set", async ({
    page,
  }) => {
    // Set only API key
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-only" },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Auth mode toggle should not be visible
    await expect(
      page.getByText("Authentication Method")
    ).not.toBeVisible();
  });

  test("should show auth mode toggle when both credentials are set", async ({
    page,
  }) => {
    // Set both credentials
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-both" },
    });
    await page.request.put("/api/settings/claudeOauthToken", {
      data: { value: "sk-ant-oat01-both" },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Auth mode toggle should be visible
    await expect(
      page.getByText("Authentication Method")
    ).toBeVisible();

    // Both toggle buttons should be visible
    const apiKeyBtn = page
      .locator("button")
      .filter({ hasText: /^API Key$/ });
    const oauthBtn = page
      .locator("button")
      .filter({ hasText: /^OAuth Token$/ });
    await expect(apiKeyBtn).toBeVisible();
    await expect(oauthBtn).toBeVisible();

    // Both credentials should show Configured badges
    const configured = page.getByText("Configured", { exact: true });
    await expect(configured).toHaveCount(2);
  });

  test("should test connection when toggling auth mode", async ({
    page,
  }) => {
    // Set both credentials
    await page.request.put("/api/settings/anthropicApiKey", {
      data: { value: "sk-ant-api-toggle" },
    });
    await page.request.put("/api/settings/claudeOauthToken", {
      data: { value: "sk-ant-oat01-toggle" },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Listen for the test connection request
    const testPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/llm-status/test") &&
        req.method() === "POST"
    );

    // Click OAuth toggle
    const oauthBtn = page
      .locator("button")
      .filter({ hasText: /^OAuth Token$/ });
    await oauthBtn.click();

    // Should have fired a test connection request
    const testReq = await testPromise;
    expect(testReq.method()).toBe("POST");

    // The auth mode setting should be saved
    const res = await page.request.get("/api/settings/anthropicAuthMode");
    const mode = await res.json();
    expect(mode).toBe("oauth");
  });
});
