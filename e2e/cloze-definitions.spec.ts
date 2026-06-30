import { test, expect, Page } from "@playwright/test";

const TEST_COLLECTION = "top500";
const TEST_SENTENCE_ID = "test-inline-def-1";

const testSentence = {
  id: TEST_SENTENCE_ID,
  sentence: "Die kat is groot.",
  clozeWord: "kat",
  clozeIndex: 1,
  translation: "The cat is big.",
  source: "tatoeba",
  collection: TEST_COLLECTION,
  masteryLevel: 0,
  nextReview: new Date().toISOString(),
  reviewCount: 0,
  timesCorrect: 0,
  timesIncorrect: 0,
};

async function startTypeRound(page: Page) {
  await page.goto("/practice");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible({
    timeout: 30000,
  });

  const learnNewSection = page.getByText("Learn New").locator("..");
  await learnNewSection
    .getByRole("button", { name: /Top 500/ })
    .first()
    .click();
  await page.getByRole("button", { name: "10", exact: true }).click();
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByText("Fill in the blank")).toBeVisible({
    timeout: 10000,
  });
}

// The drawer is always present in the DOM but slides offscreen when closed.
// A "visible" drawer = translated to translate-x-0 (we assert this via class).
async function expectDrawerOpen(page: Page) {
  const drawer = page.getByTestId("translation-drawer");
  await expect(drawer).toBeVisible({ timeout: 5000 });
  await expect(drawer).toHaveClass(/translate-x-0/);
  return drawer;
}

async function expectDrawerClosed(page: Page) {
  const drawer = page.getByTestId("translation-drawer");
  await expect(drawer).toHaveClass(/translate-x-full/);
}

test.describe("Cloze Inline Definitions (drawer)", () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post("http://localhost:3457/api/cloze", {
      data: [testSentence],
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete(
      `http://localhost:3457/api/cloze/${TEST_SENTENCE_ID}`
    );
  });

  test("opens the drawer when tapping a word in the cloze sentence", async ({
    page,
  }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();

    await expectDrawerOpen(page);
  });

  test("drawer shows the clicked word as its heading", async ({ page }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    const wordText = await clozeWords.first().textContent();
    await clozeWords.first().click();

    const drawer = await expectDrawerOpen(page);

    if (wordText) {
      const cleanWord = wordText.replace(/[.,!?;:'")\]]+$/, "");
      await expect(drawer.getByRole("heading", { name: cleanWord })).toBeVisible();
    }
  });

  test("drawer does not reveal the cloze answer in practice mode", async ({
    page,
  }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();

    const drawer = await expectDrawerOpen(page);

    // The blanked sentence renders as italic text inside the drawer's sentence
    // section. Locate it directly via the italic style — that's unique to the
    // sentence area (definitions / etymology don't use italic).
    const italicParas = drawer.locator("p.italic");
    if ((await italicParas.count()) > 0) {
      const sentenceText = await italicParas.first().textContent();
      // Blanked sentence must contain underscores in place of the cloze answer
      expect(sentenceText).toMatch(/_+/);
    }
  });

  test("drawer closes when clicking the close button", async ({ page }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();

    const drawer = await expectDrawerOpen(page);
    await drawer.getByRole("button", { name: "Close" }).click();
    await expectDrawerClosed(page);
  });

  test("drawer closes when pressing Escape", async ({ page }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();

    await expectDrawerOpen(page);
    await page.keyboard.press("Escape");
    await expectDrawerClosed(page);
  });

  test("drawer clears when advancing to the next sentence", async ({
    page,
  }) => {
    await startTypeRound(page);

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();

    await expectDrawerOpen(page);

    const input = page.locator('input[placeholder="..."]');
    await input.fill("zzzzz");
    await input.press("Enter");

    await expect(
      page.getByRole("heading", { name: "Incorrect" })
    ).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Next Sentence" }).click();
    await page.waitForTimeout(500);
    await expectDrawerClosed(page);
  });

  test("words remain clickable in the feedback state", async ({ page }) => {
    await startTypeRound(page);

    const input = page.locator('input[placeholder="..."]');
    await input.fill("zzzzz");
    await input.press("Enter");

    await expect(
      page.getByRole("heading", { name: "Incorrect" })
    ).toBeVisible({ timeout: 5000 });

    const clozeWords = page.locator('[data-testid="cloze-word"]');
    await expect(clozeWords.first()).toBeVisible();
    await clozeWords.first().click();
    await expectDrawerOpen(page);
  });

  test("the cloze blank word is not clickable", async ({ page }) => {
    await startTypeRound(page);

    const inputField = page.locator('input[placeholder="..."]');
    await expect(inputField).toBeVisible();

    const clozeWordInput = page.locator(
      '[data-testid="cloze-word"] input[placeholder="..."]'
    );
    await expect(clozeWordInput).not.toBeVisible();
  });
});
