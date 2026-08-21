import { test, expect, type Page } from "@playwright/test";
import { apiUrl } from './api';

// `collection_groups` is a language-agnostic container: a group can hold
// collections of different languages, and language lives on the collection, not
// the group. The library shows a group in the active language only when it has a
// collection in that language — OR when it has no collections at all (a
// brand-new/emptied group stays visible so it can be populated). A group whose
// collections are all in another language is hidden in the active language.
test.describe("Collection Groups — language-agnostic", () => {
  async function cleanup(page: Page) {
    const groups = await (await page.request.get(apiUrl("/api/groups"))).json();
    for (const g of groups) {
      if (g.name.startsWith("Test")) await page.request.delete(apiUrl(`/api/groups/${g.id}`));
    }
    // Collections are language-scoped, so clean each language we touch.
    for (const lang of ["af", "de"]) {
      const cols = await (await page.request.get(apiUrl(`/api/collections?language=${lang}`))).json();
      for (const c of cols) {
        if (c.title.startsWith("Test")) await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }
  }

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await cleanup(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanup(page);
  });

  async function makeGroup(page: Page, name: string): Promise<string> {
    const res = await page.request.post(apiUrl("/api/groups"), { data: { name } });
    return (await res.json()).id;
  }

  async function makeCollection(
    page: Page,
    title: string,
    language: string,
    groupId: string,
  ): Promise<string> {
    const res = await page.request.post(apiUrl("/api/collections"), {
      data: { title, author: "Test", language, groupId },
    });
    return (await res.json()).id;
  }

  // Drive the client's active language via localStorage (what getActiveLanguage
  // reads, and what the SetupGuard fast-path checks — so no /setup redirect).
  // addInitScript runs on every navigation; the latest registration wins.
  async function viewLibraryAs(page: Page, lang: string) {
    await page.addInitScript((l) => localStorage.setItem("lector-target-language", l), lang);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  }

  test("a group spans languages; other-language-only groups hide; empty groups stay", async ({
    page,
  }) => {
    const both = await makeGroup(page, "Test Both Langs");
    const deOnly = await makeGroup(page, "Test DE Only");
    const empty = await makeGroup(page, "Test Empty Group");

    await makeCollection(page, "Test AF Book", "af", both);
    await makeCollection(page, "Test DE Book", "de", both);
    await makeCollection(page, "Test DE Only Book", "de", deOnly);

    // ── Afrikaans view ───────────────────────────────────────────────────────
    await viewLibraryAs(page, "af");

    // "Both" is visible and shows ONLY its Afrikaans collection.
    await expect(page.getByTestId(`group-${both}`)).toBeVisible();
    await expect(page.getByTestId(`group-${both}`).getByRole("heading", { name: "Test AF Book" })).toBeVisible();
    await expect(page.getByText("Test DE Book")).toHaveCount(0);

    // A group whose collections are all German is hidden in the Afrikaans view.
    await expect(page.getByTestId(`group-${deOnly}`)).toHaveCount(0);

    // A brand-new empty group stays visible so it can be populated.
    await expect(page.getByTestId(`group-${empty}`)).toBeVisible();

    // ── German view ──────────────────────────────────────────────────────────
    await viewLibraryAs(page, "de");

    // The SAME "Both" group, now showing only its German collection.
    await expect(page.getByTestId(`group-${both}`)).toBeVisible();
    await expect(page.getByTestId(`group-${both}`).getByRole("heading", { name: "Test DE Book" })).toBeVisible();
    await expect(page.getByText("Test AF Book")).toHaveCount(0);

    // The German-only group is now visible, with its collection.
    await expect(page.getByTestId(`group-${deOnly}`)).toBeVisible();
    await expect(page.getByTestId(`group-${deOnly}`).getByRole("heading", { name: "Test DE Only Book" })).toBeVisible();

    // Empty group still visible.
    await expect(page.getByTestId(`group-${empty}`)).toBeVisible();
  });

  // The library lists collections under the language this browser holds, while
  // the account's `targetLanguage` setting stays 'af' (global-setup writes it).
  // A by-id read that omits the `language` param resolves it from that setting
  // instead, so it used to 404 every German collection: the page opened, the
  // read failed, and the collection page sent the reader back to the library.
  test("opens a collection in a language the account setting does not name", async ({ page }) => {
    const group = await makeGroup(page, "Test Open DE");
    const collectionId = await makeCollection(page, "Test DE Openable", "de", group);

    await viewLibraryAs(page, "de");
    await page.getByRole("heading", { name: "Test DE Openable" }).click();

    // The collection page stays open. Before the fix this bounced back to "/".
    await expect(page).toHaveURL(new RegExp(`/collection/${collectionId}$`));
    await expect(page.getByRole("heading", { name: "Test DE Openable" })).toBeVisible();
  });

  // Two tabs, one language. A switch in the first tab reloads that tab, so it
  // refetches under the new language. The second tab kept the library of the
  // previous language while its own selector already named the new one. Every
  // card in that stale list pointed outside the active language, so opening one
  // returned the reader to the library.
  test("a language switch in one tab moves the library in the other tab", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const tabOne = await context.newPage();
    const tabTwo = await context.newPage();

    try {
      const group = await makeGroup(tabOne, "Test Two Tab");
      await makeCollection(tabOne, "Test AF Two Tab", "af", group);
      await makeCollection(tabOne, "Test DE Two Tab", "de", group);

      // Both tabs open the Afrikaans library. SetupGuard copies the account
      // setting into this browser, so neither tab needs a seeded language.
      for (const tab of [tabOne, tabTwo]) {
        await tab.goto("/");
        await tab.waitForLoadState("networkidle");
        await expect(tab.getByRole("heading", { name: "Test AF Two Tab" })).toBeVisible();
      }

      // Switch to German in the first tab only.
      await tabOne.locator("aside").getByTestId("language-selector").click();
      await tabOne.getByTestId("language-option-de").first().click();
      await expect(tabOne.getByRole("heading", { name: "Test DE Two Tab" })).toBeVisible({ timeout: 15000 });

      // The second tab must follow. It used to hold the Afrikaans book, and
      // opening that book returned it to the library.
      await expect(tabTwo.getByRole("heading", { name: "Test DE Two Tab" })).toBeVisible({ timeout: 15000 });
      await expect(tabTwo.getByText("Test AF Two Tab")).toHaveCount(0);

      // The book the second tab now lists opens and stays open.
      await tabTwo.getByRole("heading", { name: "Test DE Two Tab" }).click();
      await expect(tabTwo).toHaveURL(/\/collection\//);
      await expect(tabTwo.getByRole("heading", { name: "Test DE Two Tab" })).toBeVisible();
    } finally {
      // Other specs expect the account setting to stay Afrikaans.
      await tabOne.request.put(apiUrl("/api/settings/targetLanguage"), { data: { value: "af" } });
      await context.close();
    }
  });
});
