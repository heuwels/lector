import { test, expect } from "@playwright/test";

const TEST_PREFIX = "2099"; // Far future dates to avoid conflicts

test.describe("Journal", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any test entries
    const res = await page.request.get("/api/journal?limit=100");
    const entries = await res.json();
    for (const e of entries) {
      if (e.entryDate.startsWith(TEST_PREFIX)) {
        await page.request.delete(`/api/journal/${e.id}`);
      }
    }
  });

  test("should navigate to journal page", async ({ page }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { level: 1, name: "Journal" })
    ).toBeVisible();
  });

  test("should show journal in navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Journal" })).toBeVisible();
  });

  test("should show New Entry button", async ({ page }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: "New Entry" })
    ).toBeVisible();
  });

  test("should create and save a draft entry via API", async ({ page }) => {
    const createRes = await page.request.post("/api/journal", {
      data: { body: "Dit is 'n toets inskrywing.", entryDate: "2099-01-01" },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id, entryDate } = await createRes.json();
    expect(entryDate).toBe("2099-01-01");

    const getRes = await page.request.get(`/api/journal/${id}`);
    const entry = await getRes.json();
    expect(entry.body).toBe("Dit is 'n toets inskrywing.");
    expect(entry.status).toBe("draft");
    expect(entry.wordCount).toBe(5);

    await page.request.delete(`/api/journal/${id}`);
  });

  test("should allow multiple entries per day", async ({ page }) => {
    const res1 = await page.request.post("/api/journal", {
      data: { body: "Eerste inskrywing.", entryDate: "2099-01-01" },
    });
    const res2 = await page.request.post("/api/journal", {
      data: { body: "Tweede inskrywing.", entryDate: "2099-01-01" },
    });
    expect(res1.ok()).toBeTruthy();
    expect(res2.ok()).toBeTruthy();

    const { id: id1 } = await res1.json();
    const { id: id2 } = await res2.json();
    expect(id1).not.toBe(id2);

    const listRes = await page.request.get("/api/journal?date=2099-01-01");
    const entries = await listRes.json();
    expect(entries.length).toBe(2);

    await page.request.delete(`/api/journal/${id1}`);
    await page.request.delete(`/api/journal/${id2}`);
  });

  test("should delete an entry", async ({ page }) => {
    const createRes = await page.request.post("/api/journal", {
      data: { body: "Gaan verwyder word.", entryDate: "2099-01-01" },
    });
    const { id } = await createRes.json();

    const deleteRes = await page.request.delete(`/api/journal/${id}`);
    expect(deleteRes.ok()).toBeTruthy();

    const getRes = await page.request.get(`/api/journal/${id}`);
    expect(getRes.status()).toBe(404);
  });

  test("should open editor on New Entry click", async ({ page }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "New Entry" }).click();

    await expect(page.getByPlaceholder(/skryf vandag/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Draft" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit for Correction" })
    ).toBeVisible();
  });

  test("should save draft via UI and show in history", async ({ page }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "New Entry" }).click();

    const textarea = page.getByPlaceholder(/skryf vandag/i);
    await textarea.fill("Ek het vandag geoefen.");
    await page.getByRole("button", { name: "Save Draft" }).click();

    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Draft").first()).toBeVisible();

    // Clean up
    const today = new Date().toISOString().split("T")[0];
    const res = await page.request.get(`/api/journal?date=${today}`);
    const entries = await res.json();
    for (const e of entries) {
      if (e.body === "Ek het vandag geoefen.") {
        await page.request.delete(`/api/journal/${e.id}`);
      }
    }
  });

  test("should show corrected entries with visual indicator", async ({
    page,
  }) => {
    // Create and submit via API
    const createRes = await page.request.post("/api/journal", {
      data: {
        body: "Gister ek het na die stoor gaan.",
        entryDate: "2099-02-01",
      },
    });
    const { id } = await createRes.json();
    await page.request.post(`/api/journal/${id}/correct`);

    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    // Should show correction count badge
    await expect(page.getByText(/correction/i).first()).toBeVisible();

    // Click to open detail modal
    await page
      .getByText("Gister ek het na die stoor gaan.")
      .first()
      .click();

    const modal = page.locator(".fixed.inset-0");
    await expect(modal.getByText("Your text")).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText("Corrected")).toBeVisible();

    await page.request.delete(`/api/journal/${id}`);
  });

  test("full journey: create, save draft, navigate away, return, submit", async ({
    page,
  }) => {
    const today = new Date().toISOString().split("T")[0];

    // Clean up existing today entries
    const existing = await page.request.get(`/api/journal?date=${today}`);
    const existingEntries = await existing.json();
    for (const e of existingEntries) {
      await page.request.delete(`/api/journal/${e.id}`);
    }

    // 1. Create new entry
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New Entry" }).click();

    await page
      .getByPlaceholder(/skryf vandag/i)
      .fill("Gister ek het na die stoor gaan. Ek het koop baie dinge.");

    // 2. Save as draft
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });

    // 3. Navigate away
    await page.goto("/vocab");
    await page.waitForLoadState("networkidle");

    // 4. Return — draft should be in the list
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("Gister ek het na die stoor gaan.").first()
    ).toBeVisible();

    // 5. Click draft to edit
    await page.getByText("Gister ek het na die stoor gaan.").first().click();
    await expect(page.getByPlaceholder(/skryf vandag/i)).toHaveValue(
      "Gister ek het na die stoor gaan. Ek het koop baie dinge."
    );

    // 6. Submit for correction via API (UI submission relies on Agent SDK which is slow)
    // Get the entry ID from the API
    const preEntries = await page.request.get(`/api/journal?date=${today}`);
    const drafts = await preEntries.json();
    const draft = drafts.find((e: { status: string }) => e.status === "draft");
    expect(draft).toBeTruthy();

    const correctRes = await page.request.post(
      `/api/journal/${draft.id}/correct`
    );
    expect(correctRes.ok()).toBeTruthy();

    // Reload to see the corrected entry
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    // Verify via API
    const apiRes = await page.request.get(`/api/journal?date=${today}`);
    const entries = await apiRes.json();
    const submitted = entries.find(
      (e: { status: string }) => e.status === "submitted"
    );
    expect(submitted).toBeTruthy();
    expect(submitted.corrections.length).toBeGreaterThan(0);

    for (const e of entries) {
      await page.request.delete(`/api/journal/${e.id}`);
    }
  });
});
