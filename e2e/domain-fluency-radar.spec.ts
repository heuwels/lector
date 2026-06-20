import { test, expect, type Route } from '@playwright/test';

// The radar renders from GET /api/stats/fluency's byDomain[]. A word's `domain`
// is only ever written by the background classifier (gated OFF in e2e) and no
// API sets it, so there's no way to seed a *classified* radar through the app.
// We therefore stub the fluency endpoint per-test — the aggregation + reconciliation
// is already covered by the unit test; here we exercise the component's states.

const DOMAIN_DEFS: [string, string][] = [
  ['daily_life', 'Daily life & home'],
  ['food', 'Food & cooking'],
  ['health', 'Health & medicine'],
  ['travel', 'Travel & places'],
  ['work', 'Work & business'],
  ['science_tech', 'Science & technology'],
  ['nature', 'Nature & environment'],
  ['arts_culture', 'Arts & culture'],
  ['sport_leisure', 'Sport & leisure'],
  ['society', 'Society & politics'],
];

function bandFor(axis: number): string {
  if (axis < 20) return 'Novice';
  if (axis < 45) return 'Developing';
  if (axis < 75) return 'Strong';
  return 'Expert';
}

/** Build all 10 axes, giving the named domains a non-zero value and the rest 0. */
function axes(signal: Record<string, number> = {}) {
  return DOMAIN_DEFS.map(([domain, label]) => {
    const axisValue = signal[domain] ?? 0;
    return { domain, label, knownCount: axisValue, masteryScore: axisValue, axisValue, band: bandFor(axisValue) };
  });
}

function fluencyFixture(over: { byDomain?: ReturnType<typeof axes>; pending?: number } = {}) {
  return {
    totalKnownWords: 120,
    totalLearning: 30,
    totalNew: 10,
    byState: { new: 10, level1: 8, level2: 7, level3: 8, level4: 7, known: 120, ignored: 0 },
    estimatedLevel: { code: 'A1', label: 'Beginner' },
    progressToNextLevel: 24,
    weeklyGrowth: { thisWeek: 5, lastWeek: 3, delta: 2 },
    byDomain: over.byDomain ?? axes(),
    pending: over.pending ?? 0,
  };
}

async function stubFluency(page: import('@playwright/test').Page, fixture: object) {
  await page.route('**/api/stats/fluency**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });
}

test.describe('Domain Fluency Radar', () => {
  test('renders the radar with axes when words are classified', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubFluency(page, fluencyFixture({ byDomain: axes({ food: 62, health: 40, science_tech: 25 }) }));

    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    const radar = page.locator('[data-testid="domain-fluency-radar"]');
    await expect(radar).toBeVisible({ timeout: 10000 });
    await expect(radar.getByText('Areas of Fluency')).toBeVisible();

    // Desktop chart shows; the empty state and mobile list do not.
    await expect(page.locator('[data-testid="domain-radar-chart"]')).toBeVisible();
    await expect(page.locator('[data-testid="domain-radar-empty"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="domain-radar-bandlist"]')).not.toBeVisible();
  });

  test('shows an empty state (no polygon) before anything is classified', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubFluency(page, fluencyFixture({ byDomain: axes(), pending: 0 }));

    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    const empty = page.locator('[data-testid="domain-radar-empty"]');
    await expect(empty).toBeVisible({ timeout: 10000 });
    await expect(empty.getByText(/Read and learn words/i)).toBeVisible();
    await expect(page.locator('[data-testid="domain-radar-chart"]')).toHaveCount(0);
  });

  test('surfaces a pending-classification count while the worker drains', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubFluency(page, fluencyFixture({ byDomain: axes({ food: 50 }), pending: 12 }));

    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    const pending = page.locator('[data-testid="domain-radar-pending"]');
    await expect(pending).toBeVisible({ timeout: 10000 });
    await expect(pending).toHaveText(/12 words pending classification/);
  });

  test('falls back to a sorted band list on a narrow (mobile) viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubFluency(page, fluencyFixture({ byDomain: axes({ food: 62, health: 40 }) }));

    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    const list = page.locator('[data-testid="domain-radar-bandlist"]');
    await expect(list).toBeVisible({ timeout: 10000 });
    await expect(list.getByText('Food & cooking')).toBeVisible();
    // The radar chart is hidden at this width.
    await expect(page.locator('[data-testid="domain-radar-chart"]')).not.toBeVisible();
  });
});
