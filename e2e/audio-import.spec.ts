import { test, expect, Page } from '@playwright/test';
import { apiUrl } from './api';

// Podcast import & listen-along (#185). The transcribe worker is OFF under e2e
// (TRANSCRIBE_WORKER unset), so uploads stay 'pending' — exactly what the
// processing-state tests need. The 'done' flows stub the lesson/segments/audio
// GETs with page.route, the same pattern the other specs use for external
// services; the transcription itself never runs in e2e.

/** Minimal valid 16-bit mono PCM WAV of silence. Long enough to cover the
 * stub SEGMENTS (6 s) so in-player seeks are real, not clamped. */
function silentWav(seconds = 0.1): Buffer {
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const SEGMENTS = [
  { idx: 0, startMs: 0, endMs: 2000, text: 'Goeie môre almal.' },
  { idx: 1, startMs: 2000, endMs: 4000, text: 'Welkom by die potgooi.' },
  { idx: 2, startMs: 4000, endMs: 6000, text: 'Tot volgende keer.' },
];
// A transcript long enough that the segment list overflows and scrolls —
// the #433 regression needs the learner to be able to scroll away.
const LONG_SEGMENTS = Array.from({ length: 30 }, (_, i) => ({
  idx: i,
  startMs: i * 2000,
  endMs: (i + 1) * 2000,
  text: `Sin nommer ${i + 1} van die potgooi met nog n paar woorde daarby.`,
}));

async function cleanupTestCollections(page: Page) {
  const res = await page.request.get(apiUrl('/api/collections'));
  for (const c of await res.json()) {
    if (c.title?.startsWith('E2E Oudio')) {
      await page.request.delete(apiUrl(`/api/collections/${c.id}`));
    }
  }
}

async function uploadAudio(
  page: Page,
  title: string,
): Promise<{ collectionId: string; lessonId: string }> {
  const res = await page.request.post(apiUrl('/api/import/audio'), {
    multipart: {
      file: { name: 'episode.wav', mimeType: 'audio/wav', buffer: silentWav() },
      language: 'af',
      title,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** Stub the lesson as transcribed: lesson GET, segments and audio bytes. */
async function stubTranscribedLesson(
  page: Page,
  lessonId: string,
  segments: typeof SEGMENTS = SEGMENTS,
) {
  const durationMs = segments[segments.length - 1].endMs;
  await page.route(`**/api/lessons/${lessonId}`, async (route) => {
    const response = await route.fetch();
    const lesson = await response.json();
    await route.fulfill({
      response,
      json: {
        ...lesson,
        textContent: segments.map((s) => s.text).join(' '),
        wordCount: 10,
        transcriptionStatus: 'done',
        transcriptionError: null,
        audioDurationMs: durationMs,
      },
    });
  });
  await page.route(`**/api/lessons/${lessonId}/segments`, (route) =>
    route.fulfill({ json: segments }),
  );
  await page.route(`**/api/lessons/${lessonId}/audio`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: silentWav(durationMs / 1000 + 0.5),
      headers: { 'Accept-Ranges': 'bytes' },
    }),
  );
}

test.describe('Audio import (#185)', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupTestCollections(page);
  });

  test('happy path: Import Audio uploads and the lesson shows as transcribing', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // "Import Audio" lives in the import dropdown and drives a hidden file input.
    await page
      .getByRole('button', { name: /Import/ })
      .first()
      .click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Audio' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'E2E Oudio Episode.wav',
      mimeType: 'audio/wav',
      buffer: silentWav(),
    });

    // Upload returns fast with a background-transcription notice.
    await expect(page.getByText(/transcription started/)).toBeVisible({ timeout: 15000 });

    // The new collection appears; its lesson row shows the transcribing state
    // (the worker is off under e2e, so it stays pending).
    await page.getByText('E2E Oudio Episode').first().click();
    await expect(page.getByText('Transcribing…').first()).toBeVisible({ timeout: 10000 });
  });

  test('reader holds a processing screen while transcription is pending', async ({ page }) => {
    const { lessonId } = await uploadAudio(page, 'E2E Oudio Pending');

    await page.goto(`/read/${lessonId}`);
    await expect(page.getByTestId('transcription-pending')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Transcribing audio…')).toBeVisible();
  });

  test('reader shows a retryable error screen for a failed transcription', async ({ page }) => {
    const { lessonId } = await uploadAudio(page, 'E2E Oudio Error');

    await page.route(`**/api/lessons/${lessonId}`, async (route) => {
      const response = await route.fetch();
      const lesson = await response.json();
      await route.fulfill({
        response,
        json: {
          ...lesson,
          transcriptionStatus: 'error',
          transcriptionError: 'ASR provider returned 503',
        },
      });
    });

    await page.goto(`/read/${lessonId}`);
    await expect(page.getByTestId('transcription-error')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ASR provider returned 503')).toBeVisible();
    await expect(page.getByTestId('retry-transcription')).toBeVisible();
  });

  test('listen-along: segments, word coloring, shadow drill and exit', async ({ page }) => {
    const { lessonId } = await uploadAudio(page, 'E2E Oudio Klaar');
    await stubTranscribedLesson(page, lessonId);

    await page.goto(`/read/${lessonId}`);
    // Reading mode works (transcript-as-lesson) and offers the listen toggle.
    await expect(page.getByText('Goeie môre almal.')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('listen-along-toggle').click();

    // Continuous mode: all segments render as tappable reader words.
    await expect(page.getByTestId('listen-along')).toBeVisible();
    await expect(page.getByTestId('listen-segment')).toHaveCount(3);
    expect(
      await page.getByTestId('listen-along').getByTestId('reader-word').count(),
    ).toBeGreaterThan(5);
    await expect(page.getByTestId('listen-scrubber')).toBeVisible();

    // Tapping a segment row (not a word — aim at the row's padding) seeks and
    // marks it active.
    await page
      .getByTestId('listen-segment')
      .nth(1)
      .click({ position: { x: 6, y: 6 } });
    await expect(page.getByTestId('listen-segment').nth(1)).toHaveAttribute(
      'data-active-segment',
      'true',
    );

    // Shadow sub-mode: stepped sentence drill with k-of-n progress.
    await page.getByTestId('listen-mode-shadow').click();
    await expect(page.getByTestId('listen-progress')).toHaveText('Sentence 2 of 3');
    await expect(page.getByTestId('listen-scrubber')).toHaveCount(0);
    await expect(page.getByTestId('listen-repeat')).toBeVisible();
    await page.getByTestId('listen-next-sentence').click();
    await expect(page.getByTestId('listen-progress')).toHaveText('Sentence 3 of 3');

    // Back to reading mode.
    await page.getByTestId('listen-along-exit').click();
    await expect(page.getByTestId('listen-along')).toHaveCount(0);
    await expect(page.getByText('Goeie môre almal.')).toBeVisible();
  });

  test('tapping a word in listen-along pauses audio and opens the drawer', async ({ page }) => {
    const { lessonId } = await uploadAudio(page, 'E2E Oudio Woord');
    await stubTranscribedLesson(page, lessonId);
    await page.route('**/api/translate/gloss', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '[translated]' }),
    );

    await page.goto(`/read/${lessonId}`);
    await page.getByTestId('listen-along-toggle').click();
    await expect(page.getByTestId('listen-along')).toBeVisible();

    await page
      .getByTestId('listen-along')
      .getByTestId('reader-word')
      .filter({ hasText: 'potgooi' })
      .first()
      .click();

    // Auto-paused + drawer opened on the tapped word.
    await expect
      .poll(() =>
        page.getByTestId('listen-audio').evaluate((el) => (el as HTMLAudioElement).paused),
      )
      .toBe(true);
    await expect(page.getByRole('heading', { name: 'potgooi' })).toBeVisible({ timeout: 10000 });
  });

  test('word tap keeps the scroll position while the drill is playing (#433)', async ({ page }) => {
    const { lessonId } = await uploadAudio(page, 'E2E Oudio Rol');
    await stubTranscribedLesson(page, lessonId, LONG_SEGMENTS);
    await page.route('**/api/translate/gloss', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '[translated]' }),
    );

    await page.goto(`/read/${lessonId}`);
    await page.getByTestId('listen-along-toggle').click();
    await expect(page.getByTestId('listen-segment')).toHaveCount(LONG_SEGMENTS.length);

    // Shadow drill on sentence 1 (top of the list), playing.
    await page.getByTestId('listen-mode-shadow').click();
    await page.getByTestId('listen-play-pause').click();
    await expect
      .poll(() =>
        page.getByTestId('listen-audio').evaluate((el) => (el as HTMLAudioElement).paused),
      )
      .toBe(false);

    // The learner scrolls away mid-unit, then taps a word to look it up.
    const scroller = page.getByTestId('listen-along').locator('div.flex-1.overflow-auto');
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight; // far from the drill sentence
    });

    const word = page
      .getByTestId('listen-along')
      .getByTestId('reader-word')
      .filter({ hasText: 'woorde' })
      .last();
    await word.scrollIntoViewIfNeeded();
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(500);
    await word.click();

    // Drawer opens and audio pauses — but the pause must NOT hand the view
    // back to the keep-in-view effect (#433: the reader yanked to the drill
    // sentence, i.e. the top, exactly as the drawer opened).
    await expect(page.getByTestId('translation-drawer')).toHaveAttribute('aria-hidden', 'false');
    await expect
      .poll(() =>
        page.getByTestId('listen-audio').evaluate((el) => (el as HTMLAudioElement).paused),
      )
      .toBe(true);
    // Give a would-be smooth glide time to move the view, then assert it hasn't.
    await page.waitForTimeout(1200);
    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(50);
  });
});
