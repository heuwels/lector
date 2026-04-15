import { test, expect } from "@playwright/test";

const TEST_DATE = "2099-01-01"; // Far future to avoid conflicts

test.describe("Journal", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any test entries
    const res = await page.request.get("/api/journal?limit=100");
    const entries = await res.json();
    for (const e of entries) {
      if (e.entryDate.startsWith("2099")) {
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

  test("should save a draft entry via API and display it", async ({
    page,
  }) => {
    // Create draft via API
    const createRes = await page.request.post("/api/journal", {
      data: {
        body: "Dit is 'n toets inskrywing.",
        entryDate: TEST_DATE,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id, entryDate } = await createRes.json();
    expect(entryDate).toBe(TEST_DATE);

    // Verify via GET
    const getRes = await page.request.get(`/api/journal?date=${TEST_DATE}`);
    const entry = await getRes.json();
    expect(entry.body).toBe("Dit is 'n toets inskrywing.");
    expect(entry.status).toBe("draft");
    expect(entry.wordCount).toBe(5);

    // Clean up
    await page.request.delete(`/api/journal/${id}`);
  });

  test("should update a draft entry", async ({ page }) => {
    // Create
    const createRes = await page.request.post("/api/journal", {
      data: { body: "Eerste teks.", entryDate: TEST_DATE },
    });
    const { id } = await createRes.json();

    // Update
    const updateRes = await page.request.put(`/api/journal/${id}`, {
      data: { body: "Opgedateerde teks met meer woorde." },
    });
    expect(updateRes.ok()).toBeTruthy();

    // Verify
    const getRes = await page.request.get(`/api/journal/${id}`);
    const entry = await getRes.json();
    expect(entry.body).toBe("Opgedateerde teks met meer woorde.");
    expect(entry.wordCount).toBe(5);

    await page.request.delete(`/api/journal/${id}`);
  });

  test("should not allow editing a submitted entry", async ({ page }) => {
    // Create and submit via API
    const createRes = await page.request.post("/api/journal", {
      data: { body: "Vandag is 'n goeie dag.", entryDate: TEST_DATE },
    });
    const { id } = await createRes.json();

    // Submit for correction
    const correctRes = await page.request.post(
      `/api/journal/${id}/correct`
    );
    expect(correctRes.ok()).toBeTruthy();
    const correction = await correctRes.json();
    expect(correction.correctedBody).toBeTruthy();

    // Verify status is submitted
    const getRes = await page.request.get(`/api/journal/${id}`);
    const entry = await getRes.json();
    expect(entry.status).toBe("submitted");

    // Attempt to edit should fail
    const editRes = await page.request.put(`/api/journal/${id}`, {
      data: { body: "Nuwe teks" },
    });
    expect(editRes.status()).toBe(400);

    await page.request.delete(`/api/journal/${id}`);
  });

  test("should delete an entry", async ({ page }) => {
    const createRes = await page.request.post("/api/journal", {
      data: { body: "Gaan verwyder word.", entryDate: TEST_DATE },
    });
    const { id } = await createRes.json();

    const deleteRes = await page.request.delete(`/api/journal/${id}`);
    expect(deleteRes.ok()).toBeTruthy();

    // Verify gone
    const getRes = await page.request.get(`/api/journal/${id}`);
    expect(getRes.status()).toBe(404);
  });

  test("should reject creating a duplicate submitted date", async ({
    page,
  }) => {
    // Create and submit
    const createRes = await page.request.post("/api/journal", {
      data: {
        body: "Vandag het ek geleer.",
        entryDate: TEST_DATE,
      },
    });
    const { id } = await createRes.json();

    await page.request.post(`/api/journal/${id}/correct`);

    // Try to create another entry for same date
    const dupRes = await page.request.post("/api/journal", {
      data: {
        body: "Nog 'n inskrywing.",
        entryDate: TEST_DATE,
      },
    });
    expect(dupRes.status()).toBe(400);

    await page.request.delete(`/api/journal/${id}`);
  });

  test("should list entries in reverse chronological order", async ({
    page,
  }) => {
    // Create entries for different dates
    const res1 = await page.request.post("/api/journal", {
      data: { body: "Dag een.", entryDate: "2099-01-01" },
    });
    const res2 = await page.request.post("/api/journal", {
      data: { body: "Dag twee.", entryDate: "2099-01-02" },
    });
    const res3 = await page.request.post("/api/journal", {
      data: { body: "Dag drie.", entryDate: "2099-01-03" },
    });

    const listRes = await page.request.get("/api/journal?limit=10");
    const entries = await listRes.json();
    const testEntries = entries.filter((e: { entryDate: string }) =>
      e.entryDate.startsWith("2099")
    );

    expect(testEntries.length).toBe(3);
    expect(testEntries[0].entryDate).toBe("2099-01-03");
    expect(testEntries[1].entryDate).toBe("2099-01-02");
    expect(testEntries[2].entryDate).toBe("2099-01-01");

    // Clean up
    const { id: id1 } = await res1.json();
    const { id: id2 } = await res2.json();
    const { id: id3 } = await res3.json();
    await page.request.delete(`/api/journal/${id1}`);
    await page.request.delete(`/api/journal/${id2}`);
    await page.request.delete(`/api/journal/${id3}`);
  });

  test("should show textarea and both action buttons on journal page", async ({
    page,
  }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    // Textarea should be visible
    await expect(
      page.getByPlaceholder(/skryf vandag/i)
    ).toBeVisible();

    // Both buttons should be visible
    await expect(
      page.getByRole("button", { name: "Save Draft" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit for Correction" })
    ).toBeVisible();
  });

  test("should save draft via UI", async ({ page }) => {
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    const textarea = page.getByPlaceholder(/skryf vandag/i);
    await textarea.fill("Ek het vandag geoefen.");

    // Click save draft
    await page.getByRole("button", { name: "Save Draft" }).click();

    // Should see "Draft saved" confirmation
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });

    // Verify via API that the entry was created for today
    const today = new Date().toISOString().split("T")[0];
    const res = await page.request.get(`/api/journal?date=${today}`);
    const entry = await res.json();
    if (entry) {
      expect(entry.body).toBe("Ek het vandag geoefen.");
      expect(entry.status).toBe("draft");
      // Clean up
      await page.request.delete(`/api/journal/${entry.id}`);
    }
  });

  test("full journey: write, save draft, navigate away, return, submit for correction", async ({
    page,
  }) => {
    const today = new Date().toISOString().split("T")[0];

    // Clean up any existing today entry
    const existing = await page.request.get(`/api/journal?date=${today}`);
    const existingEntry = await existing.json();
    if (existingEntry?.id) {
      await page.request.delete(`/api/journal/${existingEntry.id}`);
    }

    // 1. Navigate to journal and write an entry
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    const textarea = page.getByPlaceholder(/skryf vandag/i);
    await textarea.fill("Gister ek het na die stoor gaan. Ek het koop baie dinge.");

    // 2. Save as draft
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 5000 });

    // 3. Navigate away
    await page.goto("/vocab");
    await page.waitForLoadState("networkidle");

    // 4. Return to journal — draft should still be there
    await page.goto("/journal");
    await page.waitForLoadState("networkidle");

    const restoredTextarea = page.getByPlaceholder(/skryf vandag/i);
    await expect(restoredTextarea).toHaveValue(
      "Gister ek het na die stoor gaan. Ek het koop baie dinge."
    );

    // 5. Submit for correction
    await page.getByRole("button", { name: "Submit for Correction" }).click();

    // Should show loading state
    await expect(
      page.getByRole("button", { name: /correcting/i })
    ).toBeVisible();

    // Wait for correction to complete — textarea should be replaced by correction view
    await expect(page.getByText("Your text")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Corrected")).toBeVisible();

    // Should show at least one correction (the text has intentional errors)
    await expect(page.getByText(/correction/i)).toBeVisible();

    // Textarea should no longer be visible (entry is submitted)
    await expect(restoredTextarea).not.toBeVisible();

    // Verify via API
    const apiRes = await page.request.get(`/api/journal?date=${today}`);
    const entry = await apiRes.json();
    expect(entry.status).toBe("submitted");
    expect(entry.corrections.length).toBeGreaterThan(0);
    expect(entry.correctedBody).toBeTruthy();

    // Clean up
    await page.request.delete(`/api/journal/${entry.id}`);
  });
});
