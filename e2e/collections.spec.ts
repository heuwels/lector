import { test, expect } from "@playwright/test";
import path from "path";

test.describe("Collections & Lessons", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any existing test collections via API
    const res = await page.request.get("http://localhost:3457/api/collections");
    const collections = await res.json();
    for (const c of collections) {
      if (c.title.startsWith("Toets") || c.title.startsWith("Test")) {
        await page.request.delete(`http://localhost:3457/api/collections/${c.id}`);
      }
    }
  });

  test("should show empty library state", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Your Library").first()).toBeVisible();
  });

  test("should import an EPUB and create a collection with lessons", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(
      path.join(__dirname, "fixtures/test-book.epub")
    );

    // Wait for the collection card to appear with the title
    const card = page.locator("h3", { hasText: "Toets Boek" });
    await expect(card.first()).toBeVisible({ timeout: 10000 });

    // Should show lesson count
    await expect(page.getByText("3 lessons")).toBeVisible();
  });

  test("should navigate to collection detail and see lessons", async ({
    page,
  }) => {
    // Import EPUB via API first for speed/reliability
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click the collection card (use the heading specifically)
    await page.locator("h3", { hasText: "Toets Boek" }).first().click();
    await page.waitForLoadState("networkidle");

    // Should see collection header
    await expect(
      page.getByRole("heading", { level: 1, name: "Toets Boek" })
    ).toBeVisible();
    await expect(page.getByText("Toets Outeur")).toBeVisible();

    // Should see 3 lessons
    await expect(page.getByText("Hoofstuk 1: Die Begin")).toBeVisible();
    await expect(page.getByText("Hoofstuk 2: Die Middel")).toBeVisible();
    await expect(page.getByText("Hoofstuk 3: Die Einde")).toBeVisible();
  });

  test("should open a lesson and read markdown content", async ({ page }) => {
    // Import via API
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();

    // Get lessons
    const lessonsRes = await page.request.get(
      `http://localhost:3457/api/collections/${collectionId}/lessons`
    );
    const lessons = await lessonsRes.json();

    // Navigate directly to the first lesson
    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState("networkidle");

    // Should see the lesson content rendered
    await expect(
      page.getByText("Dit is die eerste hoofstuk")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Die man stap deur die straat")
    ).toBeVisible();
  });

  test("should show prev/next navigation between lessons", async ({
    page,
  }) => {
    // Import via API
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();

    const lessonsRes = await page.request.get(
      `http://localhost:3457/api/collections/${collectionId}/lessons`
    );
    const lessons = await lessonsRes.json();

    // Go to first lesson
    await page.goto(`/read/${lessons[0].id}`);
    await page.waitForLoadState("networkidle");

    // Should have a next button pointing to chapter 2
    const nextBtn = page.getByRole("button", {
      name: /Hoofstuk 2: Die Middel/,
    });
    await expect(nextBtn).toBeVisible();

    // Click next
    await nextBtn.click();
    await page.waitForLoadState("networkidle");

    // Should see chapter 2 content
    await expect(
      page.getByText("In die tweede hoofstuk")
    ).toBeVisible({ timeout: 10000 });

    // Should have both prev and next
    await expect(
      page.getByRole("button", { name: /Hoofstuk 1: Die Begin/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Hoofstuk 3: Die Einde/ })
    ).toBeVisible();
  });

  test("should import pasted text as a single-lesson collection", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open import dropdown and click paste
    await page.getByRole("button", { name: /import/i }).first().click();
    await page.getByText("Paste Text").click();

    // Fill the modal
    await page.locator("#paste-title").fill("Toets Artikel");
    await page.locator("#paste-author").fill("Toets Skrywer");
    await page.locator("#paste-content").fill(
      "# Toets Artikel\n\nDit is 'n toetsartikel vir die Afrikaans-leser."
    );

    // Save
    await page.getByRole("button", { name: "Save to Library" }).click();

    // Should appear in library
    const card = page.locator("h3", { hasText: "Toets Artikel" });
    await expect(card.first()).toBeVisible({ timeout: 10000 });
  });

  test("should add a lesson to an existing collection", async ({ page }) => {
    // Seed a collection via API
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();

    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("3 lessons")).toBeVisible();

    // Click "Add lesson" — opens the modal
    await page.getByTestId("add-lesson").click();

    await page.locator("#lesson-title").fill("Toets Hoofstuk 4");
    await page.locator("#lesson-content").fill(
      "Hierdie is die vierde hoofstuk wat handmatig bygevoeg is."
    );

    await page.getByRole("button", { name: "Create lesson" }).click();

    // New lesson should appear in the list and the count should update
    await expect(page.getByText("Toets Hoofstuk 4")).toBeVisible();
    await expect(page.getByText("4 lessons")).toBeVisible();
  });

  test("should rename a lesson via the edit modal", async ({ page }) => {
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();
    const lessonsRes = await page.request.get(
      `http://localhost:3457/api/collections/${collectionId}/lessons`
    );
    const lessons = await lessonsRes.json();
    const firstLessonId = lessons[0].id;

    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");

    // The edit affordance is hidden until row hover, but click works regardless
    await page.getByTestId(`edit-lesson-${firstLessonId}`).click();

    await expect(page.locator("#lesson-title")).toHaveValue(
      "Hoofstuk 1: Die Begin"
    );

    await page.locator("#lesson-title").fill("Hoofstuk 1: Die Hernoemde Begin");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByText("Hoofstuk 1: Die Hernoemde Begin")
    ).toBeVisible();
    await expect(page.getByText("Hoofstuk 1: Die Begin")).not.toBeVisible();
  });

  test("should edit lesson content and refresh the word count", async ({
    page,
  }) => {
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();
    const lessonsRes = await page.request.get(
      `http://localhost:3457/api/collections/${collectionId}/lessons`
    );
    const lessons = await lessonsRes.json();
    const firstLessonId = lessons[0].id;
    const originalWordCount = lessons[0].wordCount;

    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");

    await page.getByTestId(`edit-lesson-${firstLessonId}`).click();

    // Replace content with something of a known, very different word count
    const newContent = Array.from({ length: 5 }, (_, i) => `woord${i + 1}`).join(
      " "
    );
    await page.locator("#lesson-content").fill(newContent);
    await page.getByRole("button", { name: "Save changes" }).click();

    // Wait for the modal to close and the row to re-render
    await expect(page.locator("#lesson-content")).not.toBeVisible();

    // Word count should now be 5, not the original
    expect(originalWordCount).not.toBe(5);
    await expect(
      page
        .getByText("Hoofstuk 1: Die Begin")
        .locator("..")
        .locator("..")
        .getByText("5 words")
    ).toBeVisible();
  });

  test("should delete a collection", async ({ page }) => {
    // Create via API
    const epubPath = path.join(__dirname, "fixtures/test-book.epub");
    const fs = await import("fs");
    const buffer = fs.readFileSync(epubPath);

    const importRes = await page.request.post("http://localhost:3457/api/import/epub", {
      multipart: {
        file: {
          name: "test-book.epub",
          mimeType: "application/epub+zip",
          buffer,
        },
      },
    });
    const { collectionId } = await importRes.json();

    // Navigate to collection page
    await page.goto(`/collection/${collectionId}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { level: 1, name: "Toets Boek" })
    ).toBeVisible();

    // Click the collection delete button (not lesson delete buttons)
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Should redirect to library
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });
});
