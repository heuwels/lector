import { test, expect, type Page } from "@playwright/test";

// Per-language data partitioning (#189): user data is isolated by the active
// language. These exercise the live Next→Bun path (not just unit tests):
//  1. the collections list is language-scoped (no cross-bleed between languages);
//  2. a backup/restore round-trip through /api/data preserves each row's language
//     (the data-loss fix in #199) instead of collapsing everything onto 'af'.
//
// Seeds only cleanly-deletable entities (collections / lessons / groups) so the
// shared e2e DB is left clean for specs that assert empty-DB state. The
// knownWords/dailyStats compound-PK no-collapse case is covered by the api unit
// test (api/src/routes/data.test.ts), which can't pollute that shared state.
test.describe("Language data partitioning", () => {
  async function cleanup(page: Page) {
    for (const lang of ["af", "de"]) {
      const cols = await (await page.request.get(`http://localhost:3457/api/collections?language=${lang}`)).json();
      for (const c of cols) {
        if (c.title?.startsWith("PartTest")) {
          await page.request.delete(`http://localhost:3457/api/collections/${c.id}?language=${lang}`);
        }
      }
    }
    const groups = await (await page.request.get("http://localhost:3457/api/groups")).json();
    for (const g of groups) {
      if (g.name?.startsWith("PartTest")) await page.request.delete(`http://localhost:3457/api/groups/${g.id}`);
    }
  }

  test.beforeEach(async ({ page }) => {
    await cleanup(page);
  });
  test.afterEach(async ({ page }) => {
    await cleanup(page);
  });

  test("the collections list is scoped to the active language", async ({ page }) => {
    await page.request.post("http://localhost:3457/api/collections", {
      data: { title: "PartTest AF Book", author: "T", language: "af" },
    });
    await page.request.post("http://localhost:3457/api/collections", {
      data: { title: "PartTest DE Book", author: "T", language: "de" },
    });

    const af = (await (await page.request.get("http://localhost:3457/api/collections?language=af")).json()) as {
      title: string;
    }[];
    const de = (await (await page.request.get("http://localhost:3457/api/collections?language=de")).json()) as {
      title: string;
    }[];

    const afTitles = af.map((c) => c.title);
    const deTitles = de.map((c) => c.title);
    expect(afTitles).toContain("PartTest AF Book");
    expect(afTitles).not.toContain("PartTest DE Book");
    expect(deTitles).toContain("PartTest DE Book");
    expect(deTitles).not.toContain("PartTest AF Book");
  });

  test("backup/restore round-trips each row's language", async ({ page }) => {
    // Import a backup spanning two languages, with a group shared across them and a
    // lesson in each collection. The old restore would have flattened language to
    // 'af'; the fix threads it per row.
    const backup = {
      collectionGroups: [{ id: "ptg1", name: "PartTest Group", sortOrder: 0, createdAt: "2026-01-01T00:00:00Z" }],
      collections: [
        { id: "ptc_af", title: "PartTest AF Book", author: "T", language: "af", groupId: "ptg1", sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", lastReadAt: "2026-01-01T00:00:00Z" },
        { id: "ptc_de", title: "PartTest DE Book", author: "T", language: "de", groupId: "ptg1", sortOrder: 1, createdAt: "2026-01-01T00:00:00Z", lastReadAt: "2026-01-01T00:00:00Z" },
      ],
      lessons: [
        { id: "ptl_af", collectionId: "ptc_af", title: "AF L1", textContent: "Hallo", language: "af", createdAt: "2026-01-01T00:00:00Z", lastReadAt: "2026-01-01T00:00:00Z" },
        { id: "ptl_de", collectionId: "ptc_de", title: "DE L1", textContent: "Hallo", language: "de", createdAt: "2026-01-01T00:00:00Z", lastReadAt: "2026-01-01T00:00:00Z" },
      ],
    };

    const res = await page.request.post("http://localhost:3457/api/data", { data: backup });
    expect(res.ok()).toBeTruthy();

    const exported = (await (await page.request.get("http://localhost:3457/api/data")).json()) as {
      collections: { id: string; language: string; groupId: string | null }[];
      lessons: { id: string; language: string }[];
      collectionGroups: { id: string }[];
    };

    const cAf = exported.collections.find((c) => c.id === "ptc_af");
    const cDe = exported.collections.find((c) => c.id === "ptc_de");
    expect(cAf?.language).toBe("af");
    expect(cDe?.language).toBe("de");
    // The shared group survived the round-trip, so the restored groupId resolves.
    expect(cAf?.groupId).toBe("ptg1");
    expect(exported.collectionGroups.map((g) => g.id)).toContain("ptg1");

    // Lessons keep their own language (not flattened to the 'af' default).
    expect(exported.lessons.find((l) => l.id === "ptl_af")?.language).toBe("af");
    expect(exported.lessons.find((l) => l.id === "ptl_de")?.language).toBe("de");
  });
});
