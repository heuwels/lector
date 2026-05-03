import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Collection Groups", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Clean up test groups
    const groupsRes = await page.request.get("/api/groups");
    const groups = await groupsRes.json();
    for (const g of groups) {
      if (g.name.startsWith("Test") || g.name.startsWith("Toets")) {
        await page.request.delete(`/api/groups/${g.id}`);
      }
    }

    // Clean up test collections
    const colRes = await page.request.get("/api/collections");
    const collections = await colRes.json();
    for (const c of collections) {
      if (c.title.startsWith("Toets") || c.title.startsWith("Test")) {
        await page.request.delete(`/api/collections/${c.id}`);
      }
    }
  });

  test("should create a group via the UI", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByTestId("new-group-btn").click();
    await page.getByTestId("new-group-input").fill("Test Group");
    await page.getByTestId("new-group-submit").click();

    // Group heading should appear
    await expect(page.locator("h3", { hasText: "Test Group" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("0 items")).toBeVisible();
  });

  test("should assign a collection to a group via detail page", async ({ page }) => {
    // Create a group via API
    const groupRes = await page.request.post("/api/groups", {
      data: { name: "Test Assign Group" },
    });
    const { id: groupId } = await groupRes.json();

    // Import a test collection
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);
    const importRes = await page.request.post("/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();

    // Navigate to collection detail
    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");

    // Select the group and wait for the API call to complete
    const [updateResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/collections/") && r.request().method() === "PUT"),
      page.getByTestId("group-select").selectOption(groupId),
    ]);
    expect(updateResponse.ok()).toBeTruthy();

    // Navigate back to library
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Collection should be under the group heading
    const groupSection = page.getByTestId(`group-${groupId}`);
    await expect(groupSection).toBeVisible();
    await expect(groupSection.locator("h3", { hasText: "Test Assign Group" })).toBeVisible();
    await expect(groupSection.getByText("Toets Boek").first()).toBeVisible();
  });

  test("should ungroup a collection", async ({ page }) => {
    // Create group + collection assigned to it
    const groupRes = await page.request.post("/api/groups", {
      data: { name: "Test Ungroup" },
    });
    const { id: groupId } = await groupRes.json();

    const colRes = await page.request.post("/api/collections", {
      data: { title: "Test Ungrouped Book", author: "Test" },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.put(`/api/collections/${collectionId}`, {
      data: { groupId },
    });

    // Go to detail page and set group to None
    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("group-select").selectOption("");

    // Verify on home page
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The group section should show 0 items
    const groupSection = page.getByTestId(`group-${groupId}`);
    await expect(groupSection.getByText("0 items")).toBeVisible();
  });

  test("should rename a group", async ({ page }) => {
    const groupRes = await page.request.post("/api/groups", {
      data: { name: "Test Rename Me" },
    });
    await groupRes.json();

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h3", { hasText: "Test Rename Me" })).toBeVisible();

    // Set up dialog handler before triggering it
    page.once("dialog", async (dialog) => {
      await dialog.accept("Test Renamed");
    });
    await page.getByTestId("group-menu-btn").first().click();

    const [renameResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/groups/") && r.request().method() === "PUT"),
      page.getByTestId("group-rename-btn").click(),
    ]);
    expect(renameResponse.ok()).toBeTruthy();

    await expect(page.locator("h3", { hasText: "Test Renamed" })).toBeVisible({ timeout: 5000 });
  });

  test("should delete a group and ungroup its collections", async ({ page }) => {
    // Create group + collection
    const groupRes = await page.request.post("/api/groups", {
      data: { name: "Test Delete Group" },
    });
    const { id: groupId } = await groupRes.json();

    const colRes = await page.request.post("/api/collections", {
      data: { title: "Test Survives Delete", author: "Test" },
    });
    const { id: collectionId } = await colRes.json();
    await page.request.put(`/api/collections/${collectionId}`, {
      data: { groupId },
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set up dialog handler before triggering it
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByTestId("group-menu-btn").first().click();

    const [deleteResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/groups/") && r.request().method() === "DELETE"),
      page.getByTestId("group-delete-btn").click(),
    ]);
    expect(deleteResponse.ok()).toBeTruthy();

    // Group heading should be gone
    await expect(page.locator("h3", { hasText: "Test Delete Group" })).not.toBeVisible({ timeout: 5000 });

    // Collection should still be visible on the page (ungrouped, not orphaned)
    await expect(page.getByText("Test Survives Delete").first()).toBeVisible();
  });

  test("should create a new group from collection detail page", async ({ page }) => {
    // Create a collection
    const colRes = await page.request.post("/api/collections", {
      data: { title: "Test Detail Group Book", author: "Test" },
    });
    const { id: collectionId } = await colRes.json();

    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");

    // Set up dialog handler before selecting the option
    page.once("dialog", async (dialog) => {
      await dialog.accept("Test From Detail");
    });
    await page.getByTestId("group-select").selectOption("__new__");

    // Wait for the select to update with the new group value
    await expect(page.getByTestId("group-select")).not.toHaveValue("");
    await expect(page.getByTestId("group-select")).not.toHaveValue("__new__");

    // Verify on home page
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h3", { hasText: "Test From Detail" })).toBeVisible();
  });

  test("groups API CRUD works correctly", async ({ page }) => {
    // POST
    const createRes = await page.request.post("/api/groups", {
      data: { name: "Test API Group" },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();
    expect(id).toBeTruthy();

    // GET
    const listRes = await page.request.get("/api/groups");
    const groups = await listRes.json();
    const created = groups.find((g: { id: string }) => g.id === id);
    expect(created).toBeTruthy();
    expect(created.name).toBe("Test API Group");

    // PUT
    const updateRes = await page.request.put(`/api/groups/${id}`, {
      data: { name: "Test API Group Renamed" },
    });
    expect(updateRes.ok()).toBeTruthy();

    const listRes2 = await page.request.get("/api/groups");
    const groups2 = await listRes2.json();
    expect(groups2.find((g: { id: string }) => g.id === id).name).toBe("Test API Group Renamed");

    // DELETE
    const deleteRes = await page.request.delete(`/api/groups/${id}`);
    expect(deleteRes.ok()).toBeTruthy();

    const listRes3 = await page.request.get("/api/groups");
    const groups3 = await listRes3.json();
    expect(groups3.find((g: { id: string }) => g.id === id)).toBeUndefined();
  });

  test("should reject empty group name", async ({ page }) => {
    const res = await page.request.post("/api/groups", {
      data: { name: "" },
    });
    expect(res.status()).toBe(400);
  });
});
