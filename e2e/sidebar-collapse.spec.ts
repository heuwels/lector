import { SETTINGS_KEYS } from '@/app/settings/constants';
import { test, expect } from '@playwright/test';

test.describe('Sidebar collapse', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.evaluate((key) => localStorage.removeItem(key), SETTINGS_KEYS.SIDEBAR_COLLAPSED);
    await page.reload();
    await expect(page.locator('aside')).toBeVisible();
  });

  test('collapses to an icon rail and restores on expand', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar.getByTestId('app-name-label')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Library' })).toBeVisible();

    await sidebar.getByTestId('sidebar-collapse').click();

    await expect(sidebar.getByTestId('app-name-label')).toHaveCount(0);
    await expect(sidebar.locator('nav').getByText('Library', { exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Library' })).toBeVisible();

    const collapsedWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(collapsedWidth).toBeLessThan(80);

    await sidebar.getByTestId('sidebar-collapse').click();

    await expect(sidebar.getByTestId('app-name-label')).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Library' })).toBeVisible();
    const expandedWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(expandedWidth).toBeGreaterThan(200);
  });

  test('keeps the collapsed state after reload', async ({ page }) => {
    const sidebar = page.locator('aside');
    await sidebar.getByTestId('sidebar-collapse').click();
    await expect(sidebar.getByTestId('app-name-label')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('aside').getByTestId('app-name-label')).toHaveCount(0);
    const width = await page.locator('aside').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThan(80);
  });
});
