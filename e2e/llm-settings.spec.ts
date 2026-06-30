import { test, expect, Page } from "@playwright/test";
import { apiUrl } from './api';

async function selectOpenAIProvider(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("llm-provider").selectOption("openai");
  await expect(page.getByTestId("openai-settings")).toBeVisible();
}

test.describe("OpenAI-compatible provider settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Reset to a known state
    await page.request.delete(apiUrl("/api/settings/openaiUrl"));
    await page.request.delete(apiUrl("/api/settings/openaiApiKey"));
    await page.request.delete(apiUrl("/api/settings/openaiModel"));
    await page.request.delete(apiUrl("/api/settings/openaiPreset"));
    await page.request.put(apiUrl("/api/settings/llmProvider"), {
      data: { value: "anthropic" },
    });
  });

  test("selecting the provider reveals the unified config block", async ({ page }) => {
    await selectOpenAIProvider(page);
    await expect(page.getByTestId("openai-preset")).toBeVisible();
    await expect(page.getByTestId("openai-endpoint")).toBeVisible();
    await expect(page.getByTestId("openai-api-key")).toBeVisible();
    await expect(page.getByTestId("openai-model")).toBeVisible();
    await expect(page.getByTestId("openai-fetch-models")).toBeVisible();
  });

  test("API key input is type=password (does not leak via the DOM)", async ({ page }) => {
    await selectOpenAIProvider(page);
    await expect(page.getByTestId("openai-api-key")).toHaveAttribute("type", "password");
  });

  test("preset autofills the endpoint", async ({ page }) => {
    await selectOpenAIProvider(page);

    await page.getByTestId("openai-preset").selectOption("lmstudio");
    await expect(page.getByTestId("openai-endpoint")).toHaveValue("http://localhost:1234");

    await page.getByTestId("openai-preset").selectOption("ollama");
    await expect(page.getByTestId("openai-endpoint")).toHaveValue("http://localhost:11434");
  });

  test("fetch-models populates the model list", async ({ page }) => {
    await page.route("**/api/llm/openai/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: ["meta-llama/llama-3-8b", "openai/gpt-oss-20b"] }),
      });
    });

    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://localhost:1234");
    await page.getByTestId("openai-fetch-models").click();

    // The model field is a free-text input backed by a <datalist>.
    await expect(
      page.locator('#openai-model-options option[value="meta-llama/llama-3-8b"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('#openai-model-options option[value="openai/gpt-oss-20b"]'),
    ).toHaveCount(1);
  });

  test("fetch-models surfaces an error when the endpoint is unreachable", async ({ page }) => {
    await page.route("**/api/llm/openai/models", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Cannot reach LLM provider at http://localhost:1234" }),
      });
    });

    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://localhost:1234");
    await page.getByTestId("openai-fetch-models").click();
    await expect(page.getByTestId("openai-fetch-error")).toContainText("Cannot reach LLM provider");
  });

  test("a model name can be typed freely (no fetch required)", async ({ page }) => {
    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://localhost:1234");
    await page.getByTestId("openai-model").fill("some/custom-model");

    await expect.poll(async () => {
      const saved = await page.request.get(apiUrl("/api/settings/openaiModel"));
      return await saved.json();
    }).toBe("some/custom-model");
  });

  test("changing the endpoint clears the selected model", async ({ page }) => {
    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://localhost:1234");
    await page.getByTestId("openai-model").fill("alpha");

    // Change the endpoint — the selected model should clear (it may not exist there)
    await page.getByTestId("openai-endpoint").fill("http://localhost:9999");
    await expect(page.getByTestId("openai-model")).toHaveValue("");

    await expect.poll(async () => {
      const saved = await page.request.get(apiUrl("/api/settings/openaiModel"));
      const value = await saved.json();
      return value === "" || value === null;
    }).toBeTruthy();
  });

  test("saving a new API key clears the selected model and shows Configured", async ({ page }) => {
    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://localhost:1234");
    await page.getByTestId("openai-model").fill("a");

    // Save a new API key via the explicit Save button (credentials use the
    // Configured/Replace/Clear pattern, not save-on-keystroke).
    await page.getByTestId("openai-api-key").fill("sk-secret");
    await page.getByTestId("openai-api-key-save").click();
    await expect(page.getByTestId("openai-model")).toHaveValue("");
    await expect(page.getByTestId("openai-api-key-status")).toContainText("Configured");
  });

  test("API key is masked (true), never the plaintext", async ({ page }) => {
    await page.request.put(apiUrl("/api/settings/openaiApiKey"), { data: { value: "sk-very-secret" } });

    const bulk = await (await page.request.get(apiUrl("/api/settings"))).json();
    expect(bulk.openaiApiKey).toBe(true);

    const single = await (await page.request.get(apiUrl("/api/settings/openaiApiKey"))).json();
    expect(single).toBe(true);

    await page.request.delete(apiUrl("/api/settings/openaiApiKey"));
  });

  test("Clear removes the configured API key", async ({ page }) => {
    await page.request.put(apiUrl("/api/settings/openaiApiKey"), { data: { value: "sk-prior" } });
    await selectOpenAIProvider(page);

    await expect(page.getByTestId("openai-api-key-status")).toContainText("Configured");
    await page.getByTestId("openai-api-key-clear").click();

    await expect(page.getByTestId("openai-api-key")).toBeVisible();
    await expect(page.getByTestId("openai-api-key-status")).toHaveCount(0);

    const cleared = await (await page.request.get(apiUrl("/api/settings/openaiApiKey"))).json();
    expect(cleared).toBeNull();
  });

  test("fetch-models proxy is sent the typed endpoint but not the API key", async ({ page }) => {
    type ModelsBody = { endpoint?: string; apiKey?: string };
    const captured: ModelsBody[] = [];
    await page.route("**/api/llm/openai/models", async (route, request) => {
      captured.push(JSON.parse(request.postData() || "{}") as ModelsBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ models: [] }),
      });
    });

    // The page auto-fetches on endpoint change, so snapshot the count before
    // the explicit Fetch click and assert against the request the click fires.
    await selectOpenAIProvider(page);
    await page.getByTestId("openai-endpoint").fill("http://my-host:1234");
    const beforeClick = captured.length;
    await page.getByTestId("openai-fetch-models").click();

    await expect.poll(() => captured.length).toBeGreaterThan(beforeClick);
    const last = captured[captured.length - 1];
    expect(last.endpoint).toBe("http://my-host:1234");
    // The browser must NOT send the API key — the server resolves it from settings.
    expect(last.apiKey).toBeUndefined();
  });
});
