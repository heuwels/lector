import { test, expect, Page } from "@playwright/test";
import { apiUrl } from './api';

// Seed a chat message pair by mocking the LLM response
async function seedMessage(page: Page, userText: string, assistantText: string = "Mock response") {
  await page.route("**/api/chat", async (route, request) => {
    if (request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userMessage: {
            id: `user-${Date.now()}`,
            role: "user",
            content: body.message,
            provider: null,
            createdAt: new Date().toISOString(),
          },
          assistantMessage: {
            id: `asst-${Date.now()}`,
            role: "assistant",
            content: assistantText,
            provider: "claude",
            createdAt: new Date().toISOString(),
          },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe("Chat Widget", () => {
  test.beforeEach(async ({ page }) => {
    // Clear chat history before each test (direct to Hono API)
    await page.request.delete(apiUrl("/api/chat"));
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete(apiUrl("/api/chat"));
  });

  test("should show chat toggle button on any page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("chat-toggle")).toBeVisible();
  });

  test("should open and close chat panel", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open
    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-panel")).toBeVisible();

    // Close
    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-panel")).not.toBeVisible();
  });

  test("should show example prompts in empty state", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-panel")).toBeVisible();

    const examplePrompts = page.getByTestId("chat-example-prompt");
    await expect(examplePrompts.first()).toBeVisible();
    expect(await examplePrompts.count()).toBe(3);
  });

  test("should send a message and show response with provider label", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Mock the POST to avoid needing a real LLM
    await page.route("**/api/chat", async (route, request) => {
      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            userMessage: {
              id: "user-1",
              role: "user",
              content: body.message,
              provider: null,
              createdAt: new Date().toISOString(),
            },
            assistantMessage: {
              id: "asst-1",
              role: "assistant",
              content: "'Hond' means 'dog' in Afrikaans.",
              provider: "claude",
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId("chat-toggle").click();
    await page.getByTestId("chat-input").fill("What does 'hond' mean?");
    await page.getByTestId("chat-send").click();

    // Should show user message
    await expect(page.getByText("What does 'hond' mean?")).toBeVisible({ timeout: 5000 });

    // Should show assistant response
    await expect(page.getByText("'Hond' means 'dog' in Afrikaans.")).toBeVisible({ timeout: 5000 });

    // Should show provider attribution
    await expect(page.getByTestId("chat-provider-label")).toBeVisible();
    await expect(page.getByTestId("chat-provider-label")).toHaveText("via claude");
  });

  test("should send message via Enter key", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await seedMessage(page, "test");

    await page.getByTestId("chat-toggle").click();
    await page.getByTestId("chat-input").fill("How do you say hello?");
    await page.getByTestId("chat-input").press("Enter");

    // Should show the user message (optimistic)
    await expect(page.getByText("How do you say hello?")).toBeVisible({ timeout: 5000 });
  });

  test("should click example prompt to send", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await seedMessage(page, "example");

    await page.getByTestId("chat-toggle").click();

    // Click the first example prompt
    const firstPrompt = page.getByTestId("chat-example-prompt").first();
    const promptText = await firstPrompt.textContent();
    await firstPrompt.click();

    // Should show the prompt as a user message
    await expect(page.getByText(promptText!).last()).toBeVisible({ timeout: 5000 });
  });

  test("should clear chat history", async ({ page }) => {
    // Seed a message pair directly via the Hono API to have real data in DB
    // We use page.route to intercept the POST but allow GET/DELETE through
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await seedMessage(page, "test");

    await page.getByTestId("chat-toggle").click();
    await page.getByTestId("chat-input").fill("Test");
    await page.getByTestId("chat-send").click();

    // Wait for messages to appear
    await expect(page.getByText("Mock response")).toBeVisible({ timeout: 5000 });

    // Unroute to let the DELETE go through to the Hono API
    await page.unroute("**/api/chat");

    // Clear
    await page.getByTestId("chat-clear").click();

    // Should show empty state with example prompts
    await expect(page.getByTestId("chat-example-prompt").first()).toBeVisible({ timeout: 3000 });
  });

  test("should reject empty messages (send button disabled)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-toggle").click();

    // Send button should be disabled with empty input
    await expect(page.getByTestId("chat-send")).toBeDisabled();
  });

  test("should validate empty message via API", async ({ page }) => {
    const res = await page.request.post(apiUrl("/api/chat"), {
      data: { message: "" },
    });
    expect(res.status()).toBe(400);
  });

  test("should work in dark mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Enable dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });

    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-panel")).toBeVisible();

    // Panel should be visible and functional in dark mode
    const panel = page.getByTestId("chat-panel");
    await expect(panel).toHaveClass(/bg-card/);
  });

  test("should be available on practice page too", async ({ page }) => {
    await page.goto("/practice");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("chat-toggle")).toBeVisible();
  });

  test("should handle GET and DELETE via API directly", async ({ page }) => {
    // GET should return empty array
    const getRes = await page.request.get(apiUrl("/api/chat"));
    expect(getRes.ok()).toBeTruthy();
    const messages = await getRes.json();
    expect(Array.isArray(messages)).toBeTruthy();

    // DELETE should succeed
    const deleteRes = await page.request.delete(apiUrl("/api/chat"));
    expect(deleteRes.ok()).toBeTruthy();
    const result = await deleteRes.json();
    expect(result.ok).toBe(true);
  });
});
