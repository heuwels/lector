import { test, expect } from '@playwright/test';

// The About panel sources its values from build-time env (next.config.ts). In a
// local/dev build they come from `git`; in the Docker image the build context
// has no .git, so they may read "unknown". These assertions therefore check
// that the section and its labels render with a non-empty value — never a
// specific version format, which would break the Docker-image e2e run.
test.describe('Settings → About', () => {
  test('shows the version and build information', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const about = page.locator('section', {
      has: page.getByRole('heading', { name: 'About' }),
    });
    await expect(about).toBeVisible();

    // Labels that always render.
    await expect(about.getByText('Version', { exact: true })).toBeVisible();
    await expect(about.getByText('Built', { exact: true })).toBeVisible();

    // The version value is always present (at minimum the "unknown" fallback).
    const version = about.locator('div:has(dt:text-is("Version")) dd');
    await expect(version).toBeVisible();
    await expect(version).not.toBeEmpty();
  });
});
