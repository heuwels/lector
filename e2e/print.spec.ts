import { test, expect, Page } from '@playwright/test';

// Print stylesheet (#print-stylesheet): a clean, ink-friendly monochrome reading
// copy. These specs drive the reader under `print` media emulation and assert
// that (a) app chrome is removed, (b) everything renders black-on-white with the
// word-state chips collapsed to plain text, and (c) the fixed-height scroll shell
// is unwound so the whole text flows across pages instead of clipping to one
// screen. A screen-media control confirms none of this leaks into normal use.

const TITLE = 'Print Stylesheet Test';

// A heading + a paragraph with bold/italic so the article emits word leaves
// (`[data-leaf]`) — the spans the print sheet must strip back to book text.
const CONTENT = `# Die Verhaal

Die son **sak stadig** agter die *blou berge*.`;

async function seedLesson(page: Page): Promise<{ collectionId: string; lessonId: string }> {
  const colRes = await page.request.post('/api/collections', {
    data: { title: TITLE, language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(`/api/collections/${collectionId}/lessons`, {
    data: { title: 'Hoofstuk 1', textContent: CONTENT },
  });

  const lessonsRes = await page.request.get(`/api/collections/${collectionId}/lessons`);
  const lessons = await lessonsRes.json();
  return { collectionId, lessonId: lessons[0].id };
}

test.describe('Print stylesheet — monochrome reading copy', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Remove any stale collection from a previous aborted run.
    const res = await page.request.get('/api/collections');
    for (const c of await res.json()) {
      if (c.title === TITLE) await page.request.delete(`/api/collections/${c.id}`);
    }

    const seeded = await seedLesson(page);
    collectionId = seeded.collectionId;

    await page.goto(`/read/${seeded.lessonId}`);
    await page.waitForSelector('article [data-leaf]', { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) await page.request.delete(`/api/collections/${collectionId}`);
  });

  test('removes app chrome but keeps the lesson title', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });

    // Global chrome
    await expect(page.locator('aside')).toBeHidden(); // desktop sidebar (NavHeader)
    await expect(page.getByTestId('chat-toggle')).toBeHidden();

    // Reader chrome: the edit/% cluster goes, the title stays as a document heading
    await expect(page.getByTestId('edit-text-button')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Hoofstuk 1' })).toBeVisible();
  });

  test('renders black-on-white with word-state chips collapsed to plain text', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });

    const body = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { color: cs.color, bg: cs.backgroundColor };
    });
    expect(body.color).toBe('rgb(0, 0, 0)');
    expect(body.bg).toBe('rgb(255, 255, 255)');

    // Every reader word leaf must lose its bold weight and coloured chip fill.
    const leaves = await page.locator('article [data-leaf]').evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return { fw: cs.fontWeight, bg: cs.backgroundColor };
      }),
    );
    expect(leaves.length).toBeGreaterThan(0);
    for (const l of leaves) {
      expect(l.fw).toBe('400');
      expect(l.bg).toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('unwinds the scroll shell so content is not clipped to one screen', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });

    // The article's parent is the reader's `overflow-auto` scroll container.
    const scrollerOverflowY = await page
      .locator('article')
      .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).overflowY);
    expect(scrollerOverflowY).toBe('visible');

    // The base layer sets html `overflow-x: hidden` (→ computed overflow-y auto),
    // which can clip print output — the print sheet forces it visible.
    const htmlOverflowY = await page.evaluate(
      () => getComputedStyle(document.documentElement).overflowY,
    );
    expect(htmlOverflowY).toBe('visible');
  });

  test('does not affect screen rendering', async ({ page }) => {
    await page.emulateMedia({ media: 'screen' });

    await expect(page.locator('aside')).toBeVisible();
    // The warm-sand background must survive on screen (i.e. not the print white).
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });
});

test.describe('Print stylesheet — stats data-viz keeps its colour', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // Data-viz is colour-coded, so it is the one exception to the monochrome reset.
  // The Activity heatmap encodes activity as an inline background-color on each
  // cell; without the exemption the `* { background: transparent }` reset (and
  // the print dialog's default "Background graphics: off") would blank the grid.
  test('the Activity heatmap cells keep a colour fill in print', async ({ page }) => {
    await page.goto('/stats');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="activity-heatmap"]')).toBeVisible({ timeout: 10000 });

    await page.emulateMedia({ media: 'print' });

    const cellBg = await page
      .locator('[data-testid="activity-heatmap"] [style*="background"]')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cellBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(cellBg).not.toBe('transparent');
  });
});
