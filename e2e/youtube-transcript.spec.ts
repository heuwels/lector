import { test, expect } from '@playwright/test';
import { apiUrl } from './api';

// YouTube transcript import (#334). The Hono API serves fixtures via
// LECTOR_YOUTUBE_FIXTURE (playwright.config.ts) instead of live YouTube, so
// these never touch the network. Fixture videos:
//   vid00000010 — "Klein Rooikappie", Afrikaans creator + auto-generated tracks
//   vid00000011 — no captions
const VIDEO_URL = 'https://www.youtube.com/watch?v=vid00000010';
const NO_CAPTIONS_URL = 'https://youtu.be/vid00000011';

async function cleanupImports(page: import('@playwright/test').Page) {
  const res = await page.request.get(apiUrl('/api/collections'));
  const collections = await res.json();
  for (const c of collections) {
    if (['Klein Rooikappie', 'Geen onderskrifte'].includes(c.title)) {
      await page.request.delete(apiUrl(`/api/collections/${c.id}`));
    }
  }
}

test.describe('YouTube transcript import', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await cleanupImports(page);
  });
  test.afterEach(async ({ page }) => {
    await cleanupImports(page);
  });

  test('imports a captioned video and renders a timestamped, seekable transcript', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByText('YouTube Transcript').click();

    await page.getByTestId('yt-url-input').fill(VIDEO_URL);
    await page.getByTestId('yt-find-captions').click();

    // Both caption tracks are offered, creator distinguished from auto-generated.
    const options = page.getByTestId('yt-track-option');
    await expect(options).toHaveCount(2);
    await expect(page.getByText('Creator captions', { exact: true })).toBeVisible();
    await expect(page.getByText('Auto-generated', { exact: true })).toBeVisible();

    // Import the creator track → navigates to the reader.
    await options.first().click();

    await expect(page.getByTestId('transcript-reader')).toBeVisible({ timeout: 15000 });
    const segments = page.getByTestId('transcript-segment');
    await expect(segments).toHaveCount(3);

    // Timestamps are rendered per cue.
    const timestamps = page.getByTestId('transcript-timestamp');
    await expect(timestamps.nth(0)).toContainText('0:00');
    await expect(timestamps.nth(1)).toContainText('0:03');
    await expect(timestamps.nth(2)).toContainText('0:07');

    // The embedded player is present, keyed to the source video — never hosted.
    const player = page.getByTestId('yt-player');
    await expect(player).toHaveAttribute('data-video-id', 'vid00000010');

    // Clicking a cue's timestamp seeks the player to that second.
    await timestamps.nth(1).click();
    await expect(player).toHaveAttribute('data-seek-seconds', '3');
    await expect(segments.nth(1)).toHaveAttribute('data-active-segment', 'true');
  });

  test('a transcript word is clickable and opens the translation drawer', async ({ page }) => {
    // Import via the API (fixtures) for speed, then open the reader.
    const res = await page.request.post(apiUrl('/api/import/youtube'), {
      data: { url: VIDEO_URL, languageCode: 'af', kind: 'standard', language: 'af' },
    });
    expect(res.ok()).toBeTruthy();
    const { lessonId } = await res.json();

    await page.goto(`/read/${lessonId}`);
    await expect(page.getByTestId('transcript-reader')).toBeVisible({ timeout: 15000 });

    const word = page.getByTestId('reader-word').filter({ hasText: 'Eendag' }).first();
    await word.click();
    await expect(word).toHaveAttribute('data-active-word', 'true');
    await expect(page.getByTestId('translation-drawer')).toBeVisible();
  });

  test('pre-seeded known words highlight in the transcript', async ({ page }) => {
    // Seed "die" as known before importing (active-language rules apply).
    await page.request.post(apiUrl('/api/vocab'), {
      data: { text: 'die', type: 'word', state: 'known', language: 'af' },
    });

    const res = await page.request.post(apiUrl('/api/import/youtube'), {
      data: { url: VIDEO_URL, languageCode: 'af', kind: 'standard', language: 'af' },
    });
    const { lessonId } = await res.json();

    await page.goto(`/read/${lessonId}`);
    await expect(page.getByTestId('transcript-reader')).toBeVisible({ timeout: 15000 });

    // "die" appears in cues 2 and 3; both instances render with the known state.
    const die = page.getByTestId('reader-word').filter({ hasText: /^die$/ });
    await expect(die.first()).toHaveAttribute('data-word-state', 'known');

    // Cleanup the seeded vocab.
    const vocab = await (await page.request.get(apiUrl('/api/vocab?state=known'))).json();
    for (const v of vocab) {
      if (v.text === 'die') await page.request.delete(apiUrl(`/api/vocab/${v.id}`));
    }
  });

  test('shows actionable errors for invalid URLs and missing captions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByText('YouTube Transcript').click();

    // Not a YouTube URL.
    await page.getByTestId('yt-url-input').fill('https://example.com/watch?v=nope');
    await page.getByTestId('yt-find-captions').click();
    await expect(page.getByTestId('yt-import-error')).toContainText(/YouTube video URL/i);

    // A real YouTube video with no captions.
    await page.getByText('Try again').click();
    await page.getByTestId('yt-url-input').fill(NO_CAPTIONS_URL);
    await page.getByTestId('yt-find-captions').click();
    await expect(page.getByTestId('yt-import-error')).toContainText(/no available transcript/i);
  });
});
