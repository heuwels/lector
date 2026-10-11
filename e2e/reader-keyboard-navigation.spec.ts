import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

async function importLessonWithWords(page: Page) {
  const colRes = await page.request.post(apiUrl('/api/collections'), {
    data: { title: 'Nav Test', language: 'af' },
  });
  const { id: collectionId } = await colRes.json();

  await page.request.post(apiUrl(`/api/collections/${collectionId}/lessons`), {
    data: {
      title: 'Hoofstuk 1',
      textContent: 'Die kat sit op die tafel. Die hond slaap. Die voël vlieg.',
    },
  });

  const lessonsRes = await page.request.get(apiUrl(`/api/collections/${collectionId}/lessons`));
  const lessons = await lessonsRes.json();

  await page.goto(`/read/${lessons[0].id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('kat')).toBeVisible({ timeout: 10000 });

  return collectionId;
}

test.describe('Reader keyboard navigation', () => {
  let collectionId: string;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.route('**/api/translate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          translation: `[translated: ${body.word}]`,
          partOfSpeech: body.type === 'phrase' ? 'phrase' : 'noun',
        }),
      });
    });

    await page.route('**/api/translate/gloss', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: `[translated: ${body.word}]`,
      });
    });

    // Clean up leftover test collections
    const res = await page.request.get(apiUrl('/api/collections'));
    const collections = await res.json();
    for (const c of collections) {
      if (c.title === 'Nav Test') {
        await page.request.delete(apiUrl(`/api/collections/${c.id}`));
      }
    }

    // Clean up vocab entries for test words
    for (const word of ['kat', 'sit', 'op', 'hond', 'voël']) {
      const vocabRes = await page.request.get(apiUrl(`/api/vocab?text=${word}`));
      const entries = await vocabRes.json();
      for (const v of entries) {
        await page.request.delete(apiUrl(`/api/vocab/${v.id}`));
      }
    }

    collectionId = await importLessonWithWords(page);
  });

  test.afterEach(async ({ page }) => {
    if (collectionId) {
      await page.request.delete(apiUrl(`/api/collections/${collectionId}`));
    }
  });

  test('ArrowRight advances from clicked word without resetting to first', async ({ page }) => {
    // Click a non-first word to set the cursor
    const words = page.locator('[data-word-state]');
    const targetWord = words.nth(2); // third word (index 2)
    await targetWord.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Press ArrowRight — should advance to word 3 (index 3), NOT word 1
    await page.keyboard.press('ArrowRight');

    // The drawer should now show the next word
    const drawerHeading = drawer.getByRole('heading');
    const headingText = await drawerHeading.textContent();
    const targetText = await words.nth(2).textContent();
    const nextText = await words.nth(3).textContent();
    expect(headingText).toContain(nextText);
    expect(headingText).not.toContain(targetText);
  });

  test('ArrowRight multiple times advances sequentially without reset', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    const firstWord = words.first();
    await firstWord.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Press ArrowRight twice
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Should be on word index 2 (third word), not stuck on any earlier position
    const headingText = await drawer.getByRole('heading').textContent();
    const word2Text = await words.nth(2).textContent();
    expect(headingText).toContain(word2Text);
  });

  test('ArrowLeft moves backward from clicked word', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.nth(2).click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('ArrowLeft');

    const headingText = await drawer.getByRole('heading').textContent();
    const word1Text = await words.nth(1).textContent();
    expect(headingText).toContain(word1Text);
  });

  test('ArrowRight from body focus (no word focused)', async ({ page }) => {
    // Click the page margin to move focus away from all words
    await page.click('body');

    await page.keyboard.press('ArrowRight');

    // The first word should now be focused
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.hasAttribute('data-testid') && el.getAttribute('data-testid') === 'reader-word';
    });
    expect(focused).toBe(true);
  });

  test('Arrow navigation when drawer is closed does not open it', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().focus();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Drawer is docked (visible) but stays in idle state — no word looked up.
    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer.getByTestId('translation-drawer-empty')).toBeVisible();

    // But a word should be focused (visible focus ring via data-active-word)
    const activeWords = page.locator('[data-active-word=""]');
    expect(await activeWords.count()).toBeGreaterThan(0);
  });

  test('Arrow navigation with drawer open triggers live lookup', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('ArrowRight');

    // Drawer should show the next word
    const headingText = await drawer.getByRole('heading').textContent();
    const nextText = await words.nth(1).textContent();
    expect(headingText).toContain(nextText);
  });

  test('Shift+ArrowRight selects a phrase from the clicked word', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    await page.keyboard.press('Shift+ArrowRight');

    // The highlighted phrase should be visible
    const highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(2, { timeout: 3000 });
  });

  test('Shift+ArrowRight shows phrase with spaces in the sidebar', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Shift+Right extends the selection; with the drawer open this also
    // triggers a live lookup so the sidebar heading updates.
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(500);

    // The sidebar heading should show the two-word phrase joined by a space,
    // not two words concatenated without a space ("Diekat" vs "Die kat").
    const headingText = await drawer.getByRole('heading').textContent();
    expect(headingText).toContain(' ');
    expect(headingText).not.toContain('Diekat');
  });

  test('Shift+ArrowRight extends the phrase with each press (anchor stays fixed)', async ({
    page,
  }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    // First Shift+Right: selects words 0-1 (2 words)
    await page.keyboard.press('Shift+ArrowRight');
    let highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(2, { timeout: 3000 });

    // Second Shift+Right: extends to words 0-2 (3 words) — does NOT restart from word 1
    await page.keyboard.press('Shift+ArrowRight');
    highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(3, { timeout: 3000 });

    // Third Shift+Right: extends to words 0-3 (4 words)
    await page.keyboard.press('Shift+ArrowRight');
    highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(4, { timeout: 3000 });
  });

  test('plain Arrow after Shift+Arrow clears the phrase selection', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    let highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(3, { timeout: 3000 });

    // Plain Arrow clears the shift-selection anchor and highlight
    await page.keyboard.press('ArrowRight');
    highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(0, { timeout: 3000 });
  });

  test('Shift+ArrowLeft extends backwards from the anchor', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.nth(4).click(); // Click word at index 4

    // Shift+Left: selects words 3-4 (2 words)
    await page.keyboard.press('Shift+ArrowLeft');
    let highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(2, { timeout: 3000 });

    // Shift+Left again: extends to words 2-4 (3 words)
    await page.keyboard.press('Shift+ArrowLeft');
    highlighted = page.locator('[data-phrase-highlighted]');
    await expect(highlighted).toHaveCount(3, { timeout: 3000 });
  });

  test('Escape after Shift+Arrow clears highlight then returns to idle', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    const drawer = page.getByTestId('translation-drawer');
    // Drawer should be open (Shift+Arrow triggers onLookUpWord when open)
    await expect(drawer).toBeVisible();

    // First Escape: clears the phrase highlight
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-phrase-highlighted]')).toHaveCount(0);

    // Second Escape: returns drawer to idle empty state
    await page.keyboard.press('Escape');
    await expect(drawer.getByTestId('translation-drawer-empty')).toBeVisible({
      timeout: 3000,
    });
  });

  test('Escape first clears selection, then closes drawer', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Navigate to create a selection
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // First Escape: should clear selection but drawer stays open
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible({ timeout: 3000 });

    // Second Escape: should return the drawer to its idle empty state
    await page.keyboard.press('Escape');
    await expect(drawer.getByTestId('translation-drawer-empty')).toBeVisible({ timeout: 3000 });
  });

  test('state shortcut k marks known and auto-advances', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('k');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'known', { timeout: 3000 });
  });

  test('state shortcut i (alias) ignores word and auto-advances', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('i');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'ignored', { timeout: 3000 });
  });

  test('state shortcut x (original) also ignores word', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('x');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'ignored', { timeout: 3000 });
  });

  test('state shortcut 2 sets level 2 and auto-advances', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('2');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'level2', { timeout: 3000 });
  });

  test('state shortcut k works from body focus with drawer open', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    // Move focus to body (messy real-world scenario)
    await page.click('body');

    await page.keyboard.press('k');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'known', { timeout: 3000 });
  });

  test('state shortcut works from drawer focus', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    // Move focus into the drawer
    await drawer.click();

    await page.keyboard.press('2');

    const firstWordChip = words.first();
    await expect(firstWordChip).toHaveAttribute('data-word-state', 'level2', { timeout: 3000 });
  });

  test('pressing s saves the word (does not assign a level)', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('s');

    // The drawer should show a saved state (mark-word-known button, etc.)
    await expect(drawer.getByTestId('mark-word-known')).toBeVisible({ timeout: 3000 });

    // The word should NOT have a level state assigned
    const firstWordChip = words.first();
    const state = await firstWordChip.getAttribute('data-word-state');
    expect(state).not.toMatch(/^level[1-4]$/);
  });

  test('Cmd+number does not trigger state assignment', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Meta+1');
    await page.waitForTimeout(300);

    const firstWordChip = words.first();
    const state = await firstWordChip.getAttribute('data-word-state');
    expect(state).toBe('new');
  });

  test('auto-advance does not crash when last word is reached', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    const lastWord = words.last();
    await lastWord.click();

    const drawer = page.getByTestId('translation-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText('[translated:')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('k');

    const lastWordChip = words.last();
    await expect(lastWordChip).toHaveAttribute('data-word-state', 'known', { timeout: 3000 });
  });

  test('state shortcut ignored when drawer is closed', async ({ page }) => {
    const words = page.locator('[data-word-state]');
    await words.first().focus();

    await page.keyboard.press('k');
    await page.waitForTimeout(300);

    const firstWordChip = words.first();
    const state = await firstWordChip.getAttribute('data-word-state');
    expect(state).toBe('new');
  });
});
