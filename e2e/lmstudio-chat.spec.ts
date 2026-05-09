import { test, expect } from "@playwright/test";
import * as http from "http";
import { AddressInfo } from "net";

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Spin up an in-process stub that pretends to be LM Studio. Captures incoming
 * requests so the test can assert on what lector sent (previous_response_id,
 * input string, fallback messages array).
 */
function startStub(handler: (req: CapturedRequest) => { status: number; body: unknown }): Promise<{
  url: string;
  captured: CapturedRequest[];
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const captured: CapturedRequest[] = [];
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk.toString(); });
      req.on("end", () => {
        let body: unknown = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        const captureEntry: CapturedRequest = {
          method: req.method || "GET",
          url: req.url || "",
          body,
        };
        captured.push(captureEntry);
        const out = handler(captureEntry);
        res.writeHead(out.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        captured,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test.describe("Chat with LM Studio provider", () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete("/api/chat");
  });

  test.afterEach(async ({ page }) => {
    // Reset provider so other tests don't get LM Studio routing
    await page.request.put("/api/settings/llmProvider", { data: { value: "ollama" } });
    await page.request.delete("/api/settings/lmstudioUrl");
    await page.request.delete("/api/settings/lmstudioModel");
    await page.request.post("/api/llm-status/reset");
    await page.request.delete("/api/chat");
  });

  test("threads previous_response_id between messages", async ({ page }) => {
    let nextResponseId = 1;
    const stub = await startStub((req) => {
      if (req.url === "/api/v1/chat") {
        const responseId = `resp_${nextResponseId++}`;
        return {
          status: 200,
          body: {
            response_id: responseId,
            output: [{ type: "message", content: `reply ${responseId}` }],
          },
        };
      }
      return { status: 404, body: { error: "not handled" } };
    });

    try {
      await page.request.put("/api/settings/llmProvider", { data: { value: "lmstudio" } });
      await page.request.put("/api/settings/lmstudioUrl", { data: { value: stub.url } });
      await page.request.put("/api/settings/lmstudioModel", { data: { value: "test/model" } });
      await page.request.post("/api/llm-status/reset");

      // First message — no previous_response_id should be sent
      const r1 = await page.request.post("/api/chat", {
        data: { message: "first message", language: "af" },
      });
      expect(r1.ok()).toBeTruthy();
      const data1 = await r1.json();
      expect(data1.assistantMessage.content).toBe("reply resp_1");

      // Second message — previous_response_id from message #1 should be threaded in
      const r2 = await page.request.post("/api/chat", {
        data: { message: "second message", language: "af" },
      });
      expect(r2.ok()).toBeTruthy();
      const data2 = await r2.json();
      expect(data2.assistantMessage.content).toBe("reply resp_2");

      // Inspect what the stub received
      const chatCalls = stub.captured.filter((c) => c.url === "/api/v1/chat");
      expect(chatCalls).toHaveLength(2);
      const body0 = chatCalls[0].body as Record<string, unknown>;
      const body1 = chatCalls[1].body as Record<string, unknown>;
      expect(body0.input).toBe("first message");
      expect(body0.previous_response_id).toBeUndefined();
      expect(body1.input).toBe("second message");
      expect(body1.previous_response_id).toBe("resp_1");
      // System prompt should always be sent
      expect(typeof body0.system_prompt).toBe("string");
      expect(body0.system_prompt as string).toContain("Afrikaans");
    } finally {
      await stub.close();
    }
  });

  test("falls back to stateless complete() when previous_response_id is rejected", async ({ page }) => {
    let firstChatCallReceived = false;
    const stub = await startStub((req) => {
      if (req.url === "/api/v1/chat") {
        if (!firstChatCallReceived) {
          firstChatCallReceived = true;
          return {
            status: 200,
            body: {
              response_id: "resp_seed",
              output: [{ type: "message", content: "seed reply" }],
            },
          };
        }
        // Second call: reject the previous_response_id
        return { status: 404, body: { error: "previous_response_id not found" } };
      }
      // Fallback path uses /v1/chat/completions
      if (req.url === "/v1/chat/completions") {
        return {
          status: 200,
          body: {
            choices: [{ message: { content: "fallback reply with full history" } }],
          },
        };
      }
      return { status: 404, body: { error: "not handled" } };
    });

    try {
      await page.request.put("/api/settings/llmProvider", { data: { value: "lmstudio" } });
      await page.request.put("/api/settings/lmstudioUrl", { data: { value: stub.url } });
      await page.request.put("/api/settings/lmstudioModel", { data: { value: "test/model" } });
      await page.request.post("/api/llm-status/reset");

      const r1 = await page.request.post("/api/chat", {
        data: { message: "hi", language: "af" },
      });
      expect(r1.ok()).toBeTruthy();
      expect((await r1.json()).assistantMessage.content).toBe("seed reply");

      const r2 = await page.request.post("/api/chat", {
        data: { message: "again", language: "af" },
      });
      expect(r2.ok()).toBeTruthy();
      const data2 = await r2.json();
      expect(data2.assistantMessage.content).toBe("fallback reply with full history");

      // Verify the stub saw the fallback /v1/chat/completions call with the full history
      const fallbackCalls = stub.captured.filter((c) => c.url === "/v1/chat/completions");
      expect(fallbackCalls).toHaveLength(1);
      const fallbackBody = fallbackCalls[0].body as { messages?: Array<{ role: string; content: string }> };
      expect(Array.isArray(fallbackBody.messages)).toBe(true);
      const messages = fallbackBody.messages!;
      expect(messages.length).toBeGreaterThanOrEqual(3);
      expect(messages[messages.length - 1].content).toContain("again");
    } finally {
      await stub.close();
    }
  });
});
