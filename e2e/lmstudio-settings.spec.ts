import { test, expect, Page } from "@playwright/test";

async function selectLmStudioProvider(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.locator('select').first().selectOption("lmstudio");
  await expect(page.getByTestId("lmstudio-settings")).toBeVisible();
}

test.describe("LM Studio settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Reset to a known state
    await page.request.delete("/api/settings/lmstudioUrl");
    await page.request.delete("/api/settings/lmstudioApiKey");
    await page.request.delete("/api/settings/lmstudioModel");
    await page.request.put("/api/settings/llmProvider", {
      data: { value: "ollama" },
    });
  });

  test("selecting LM Studio provider reveals the config block", async ({ page }) => {
    await selectLmStudioProvider(page);
    await expect(page.getByTestId("lmstudio-endpoint")).toBeVisible();
    await expect(page.getByTestId("lmstudio-api-key")).toBeVisible();
    await expect(page.getByTestId("lmstudio-model")).toBeVisible();
    await expect(page.getByTestId("lmstudio-fetch-models")).toBeVisible();
    await expect(page.getByTestId("lmstudio-load")).toBeVisible();
    // Status pill should start as Idle
    await expect(page.getByTestId("lmstudio-load-status")).toHaveAttribute("data-status", "idle");
  });

  test("API key input is type=password (does not leak via the DOM)", async ({ page }) => {
    await selectLmStudioProvider(page);
    await expect(page.getByTestId("lmstudio-api-key")).toHaveAttribute("type", "password");
  });

  test("fetch-models populates the dropdown", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["meta-llama/llama-3-8b", "openai/gpt-oss-20b"] }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();

    const modelSelect = page.getByTestId("lmstudio-model");
    await expect(modelSelect.locator('option[value="meta-llama/llama-3-8b"]')).toHaveCount(1);
    await expect(modelSelect.locator('option[value="openai/gpt-oss-20b"]')).toHaveCount(1);
  });

  test("fetch-models surfaces an error when the endpoint is unreachable", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Cannot reach LM Studio at http://localhost:1234" }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();
    await expect(page.getByTestId("lmstudio-fetch-error")).toContainText("Cannot reach LM Studio");
  });

  test("Load button moves the status pill from Idle → Loaded", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["my-model"] }),
      });
    });
    await page.route("**/api/llm/lmstudio/load", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, instanceId: "inst_1", loadTimeSeconds: 1.2 }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();
    await page.getByTestId("lmstudio-model").selectOption("my-model");

    await page.getByTestId("lmstudio-load").click();
    await expect(page.getByTestId("lmstudio-load-status")).toHaveAttribute("data-status", "loaded");
  });

  test("Load failure shows error pill and message", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["my-model"] }),
      });
    });
    await page.route("**/api/llm/lmstudio/load", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Model not found" }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();
    await page.getByTestId("lmstudio-model").selectOption("my-model");
    await page.getByTestId("lmstudio-load").click();

    await expect(page.getByTestId("lmstudio-load-status")).toHaveAttribute("data-status", "errored");
    await expect(page.getByTestId("lmstudio-load-error")).toContainText("Model not found");
  });

  test("changing the endpoint clears the selected model and load status", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["alpha", "beta"] }),
      });
    });
    await page.route("**/api/llm/lmstudio/load", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();
    await page.getByTestId("lmstudio-model").selectOption("alpha");
    await page.getByTestId("lmstudio-load").click();
    await expect(page.getByTestId("lmstudio-load-status")).toHaveAttribute("data-status", "loaded");

    // Change the endpoint — model selection AND the load status should clear
    await page.getByTestId("lmstudio-endpoint").fill("http://localhost:9999");
    await expect(page.getByTestId("lmstudio-load-status")).toHaveAttribute("data-status", "idle");
    // Persisted model should also be cleared on the server
    const saved = await page.request.get("/api/settings/lmstudioModel");
    const value = await saved.json();
    expect(value === "" || value === null).toBeTruthy();
  });

  test("saving a new API key clears the selected model", async ({ page }) => {
    await page.route("**/api/llm/lmstudio/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["a"] }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-fetch-models").click();
    await page.getByTestId("lmstudio-model").selectOption("a");

    // Save a new API key via the explicit Save button (the input no longer
    // saves on every keystroke — credentials use Configured/Replace/Clear).
    await page.getByTestId("lmstudio-api-key").fill("sk-secret");
    await page.getByTestId("lmstudio-api-key-save").click();
    await expect(page.getByTestId("lmstudio-model")).toHaveValue("");

    await expect.poll(async () => {
      const saved = await page.request.get("/api/settings/lmstudioModel");
      const value = await saved.json();
      return value === "" || value === null;
    }).toBeTruthy();

    // Status should now show Configured (not the plaintext key)
    await expect(page.getByTestId("lmstudio-api-key-status")).toContainText("Configured");
  });

  test("API key load returns true (masked) — never the plaintext", async ({ page }) => {
    await page.request.put("/api/settings/lmstudioApiKey", { data: { value: "sk-very-secret" } });

    // Both the bulk and single-key endpoints should mask
    const bulk = await (await page.request.get("/api/settings")).json();
    expect(bulk.lmstudioApiKey).toBe(true);

    const single = await (await page.request.get("/api/settings/lmstudioApiKey")).json();
    expect(single).toBe(true);

    // Cleanup
    await page.request.delete("/api/settings/lmstudioApiKey");
  });

  test("Clear removes the configured API key", async ({ page }) => {
    await page.request.put("/api/settings/lmstudioApiKey", { data: { value: "sk-prior" } });
    await selectLmStudioProvider(page);

    await expect(page.getByTestId("lmstudio-api-key-status")).toContainText("Configured");
    await page.getByTestId("lmstudio-api-key-clear").click();

    // Should switch back to the password input
    await expect(page.getByTestId("lmstudio-api-key")).toBeVisible();
    await expect(page.getByTestId("lmstudio-api-key-status")).toHaveCount(0);

    const cleared = await (await page.request.get("/api/settings/lmstudioApiKey")).json();
    expect(cleared).toBeNull();
  });

  test("fetch-models proxy is sent the typed endpoint but not the API key", async ({ page }) => {
    type ModelsBody = { endpoint?: string; apiKey?: string };
    const captured: ModelsBody[] = [];
    await page.route("**/api/llm/lmstudio/models", async (route, request) => {
      captured.push(JSON.parse(request.postData() || "{}") as ModelsBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      });
    });

    await selectLmStudioProvider(page);
    await page.getByTestId("lmstudio-endpoint").fill("http://my-host:1234");
    await page.getByTestId("lmstudio-fetch-models").click();

    await expect.poll(() => captured[0]?.endpoint).toBe("http://my-host:1234");
    // The browser must NOT send the API key — server resolves it from settings.
    expect(captured[0]?.apiKey).toBeUndefined();
  });
});
