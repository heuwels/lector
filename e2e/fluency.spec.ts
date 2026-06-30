import { test, expect } from '@playwright/test';
import { apiUrl } from './api';

test.describe('Fluency Benchmarks', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('should display fluency section on stats page with level badge', async ({ page }) => {
    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    // Fluency section should be visible
    const section = page.locator('[data-testid="fluency-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // Level badge should show A1 (low word count from test data)
    const badge = page.locator('[data-testid="fluency-level-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('A1');

    // Should display the level description
    await expect(section.getByText('Beginner')).toBeVisible();

    // Progress bar should exist
    const progressBar = page.locator('[data-testid="fluency-progress-bar"]');
    await expect(progressBar).toBeVisible();

    // The bar names the target level and shows a words-to-go countdown
    // (A1 band → next level A2), instead of a bare percentage.
    const wordsToNext = page.locator('[data-testid="fluency-words-to-next"]');
    await expect(wordsToNext).toBeVisible();
    await expect(wordsToNext).toHaveText(/words to A2/);

    // Known and learning counts should be visible (values may vary
    // depending on data left by other tests, so just check they render)
    const knownCount = page.locator('[data-testid="fluency-known-count"]');
    await expect(knownCount).toBeVisible();
    await expect(knownCount).toHaveText(/^\d+$/);

    const learningCount = page.locator('[data-testid="fluency-learning-count"]');
    await expect(learningCount).toBeVisible();
    await expect(learningCount).toHaveText(/^\d+$/);
  });

  test('should show CEFR level label with description', async ({ page }) => {
    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    const section = page.locator('[data-testid="fluency-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    // Should show "A1 — Beginner" text
    await expect(section.getByText(/A1\s*—\s*Beginner/)).toBeVisible();

    // Should show "Estimated CEFR Level" subtitle
    await expect(section.getByText('Estimated CEFR Level')).toBeVisible();
  });

  test('fluency API endpoint should return valid data', async ({ page }) => {
    const response = await page.request.get(apiUrl('/api/stats/fluency'));
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('totalKnownWords');
    expect(data).toHaveProperty('totalLearning');
    expect(data).toHaveProperty('totalNew');
    expect(data).toHaveProperty('byState');
    // The totals must be derived from byState — one calculation app-wide
    expect(data.totalKnownWords).toBe(data.byState.known);
    expect(data.totalLearning).toBe(
      data.byState.level1 + data.byState.level2 + data.byState.level3 + data.byState.level4,
    );
    expect(data).toHaveProperty('estimatedLevel');
    expect(data.estimatedLevel).toHaveProperty('code');
    expect(data.estimatedLevel).toHaveProperty('label');
    expect(data.estimatedLevel).toHaveProperty('min');
    expect(data.estimatedLevel).toHaveProperty('max');
    expect(data).toHaveProperty('nextLevel');
    expect(data).toHaveProperty('progressToNextLevel');
    expect(data).toHaveProperty('wordsToNextLevel');
    expect(data).toHaveProperty('weeklyGrowth');
    expect(data.weeklyGrowth).toHaveProperty('thisWeek');
    expect(data.weeklyGrowth).toHaveProperty('lastWeek');
    expect(data.weeklyGrowth).toHaveProperty('delta');

    // With empty DB (0 known words) → A1, at the start of a fresh band:
    // next level is A2, the full 500-word band away.
    expect(data.estimatedLevel.code).toBe('A1');
    expect(data.totalKnownWords).toBe(0);
    expect(typeof data.progressToNextLevel).toBe('number');
    expect(data.estimatedLevel.min).toBe(0);
    expect(data.estimatedLevel.max).toBe(500);
    expect(data.nextLevel.code).toBe('A2');
    expect(data.wordsToNextLevel).toBe(500);
  });
});
