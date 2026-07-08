import { test, expect } from '@playwright/test';

/**
 * Selfhost back-compat (#218): accounts are cloud-only. The auth pages must
 * bounce a selfhost visitor straight home and the app must render with no
 * login anywhere — pinning "self-host preserves today's behaviour".
 */
test.describe('auth pages in selfhost mode', () => {
  for (const route of ['/login', '/register', '/reset-password']) {
    test(`${route} redirects home instead of rendering a form`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL((url) => url.pathname === '/');
      // The app shell (nav) is up — not an auth card.
      await expect(page.getByTestId('turnstile-widget')).toHaveCount(0);
    });
  }

  test('the app renders without any session and shows no account chrome', async ({ page }) => {
    await page.goto('/');
    // NavHeader is visible (desktop sidebar brand link), no sign-out control.
    await expect(page.getByTestId('account-sign-out')).toHaveCount(0);
  });
});
