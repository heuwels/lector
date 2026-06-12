import { test, expect } from "@playwright/test";

// The widget must thread the active language (af in e2e, set by global-setup)
// into every chat API call. Guards the regressions fixed when chat went
// per-language:
//   - GET on open must carry ?lang= (this was a `// TODO`, previously omitted)
//   - POST send must carry `language` in the body
//   - Clear must carry ?lang= on the DELETE
test.describe("Chat Widget — per-language wiring", () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete("/api/chat?lang=af");
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete("/api/chat?lang=af");
  });

  test("GET on open carries the active language", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const getReq = page.waitForRequest(
      (req) => req.url().includes("/api/chat") && req.method() === "GET"
    );
    await page.getByTestId("chat-toggle").click();

    const url = new URL((await getReq).url());
    expect(url.searchParams.get("lang")).toBe("af");
  });

  test("POST send carries the language in the body", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Mock POST so no real LLM is required.
    await page.route("**/api/chat", async (route, request) => {
      if (request.method() === "POST") {
        const body = JSON.parse(request.postData() || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            userMessage: { id: "u1", role: "user", content: body.message, provider: null, createdAt: new Date().toISOString() },
            assistantMessage: { id: "a1", role: "assistant", content: "ok", provider: "claude", createdAt: new Date().toISOString() },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId("chat-toggle").click();

    const postReq = page.waitForRequest(
      (req) => req.url().includes("/api/chat") && req.method() === "POST"
    );
    await page.getByTestId("chat-input").fill("hoe gaan dit?");
    await page.getByTestId("chat-send").click();

    const body = JSON.parse((await postReq).postData() || "{}");
    expect(body.message).toBe("hoe gaan dit?");
    expect(body.language).toBe("af");
  });

  test("clear carries the active language on the DELETE", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-panel")).toBeVisible();

    const delReq = page.waitForRequest(
      (req) => req.url().includes("/api/chat") && req.method() === "DELETE"
    );
    await page.getByTestId("chat-clear").click();

    const url = new URL((await delReq).url());
    expect(url.searchParams.get("lang")).toBe("af");
  });
});
