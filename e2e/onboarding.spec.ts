import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { apiUrl } from './api';
import { externalServer, resetSelfhostOnboarding } from './onboarding-helpers';

const UI_ORIGIN = `http://localhost:${process.env.E2E_UI_PORT || '3456'}`;
const CLOUD_API = 'http://localhost:3462';
const CLOUD_EMAILS = path.join(__dirname, '..', 'tmp', 'e2e-data-cloud', 'emails.jsonl');
const CLOUD_PASSWORD = 'guided-reader-password-123';
const AUTH_HEADERS = { Origin: UI_ORIGIN };
// Present with the same casing in both the lightweight dev fixture and the
// shipped Spanish starter lesson used by the cloud API.
const GUIDED_WORDS = ['Ana', 'Soy', 'una'] as const;

interface OnboardingSnapshot {
  progress: null | {
    status: 'in_progress' | 'completed' | 'skipped';
    currentStep: 'reader' | 'practice' | 'summary';
    language: string;
    recommendedLessonId: string | null;
    recommendedLessonTitle: string | null;
    nextLessonId: string | null;
  };
  profile: null | {
    language: string;
    approximateLevel: string;
    interests: string[];
    dailyMinutes: number;
  };
  events: Array<{
    eventType: string;
    properties: Record<string, unknown>;
  }>;
}

async function snapshot(page: Page, base = apiUrl('/api/onboarding')): Promise<OnboardingSnapshot> {
  const response = await page.request.get(base);
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  return JSON.parse(body) as OnboardingSnapshot;
}

async function mockReaderDefinitions(page: Page): Promise<void> {
  await page.route('**/api/dictionary/lookup*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entry: null }),
    }),
  );
  await page.route('**/api/translate/gloss', (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { word?: string };
    return route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: `meaning of ${body.word || 'word'}`,
    });
  });
  await page.route('**/api/translate', (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      word?: string;
      type?: string;
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        translation: `meaning of ${body.word || 'phrase'}`,
        partOfSpeech: body.type === 'phrase' ? 'phrase' : 'word',
        literalBreakdown: '',
        idiomaticMeaning: '',
        usageNotes: '',
        register: 'neutral',
      }),
    });
  });
}

async function startSpanishGuide(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
  await page.getByTestId('setup-language-es').click();
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();
  await page.getByRole('button', { name: 'Culture', exact: true }).click();
  await page.getByRole('button', { name: '20 min', exact: true }).click();
  await page.getByTestId('start-guided-onboarding').click();
  await expect(page).toHaveURL(/\/read\/[^/?]+\?onboarding=1$/, { timeout: 30_000 });
  await expect(page.getByTestId('onboarding-coach-lookup')).toBeVisible({ timeout: 15_000 });
  return new URL(page.url()).pathname.split('/').pop()!;
}

function waitForSavedEvent(page: Page) {
  return page.waitForResponse(
    (response) => {
      const request = response.request();
      if (request.method() !== 'POST' || !request.url().endsWith('/api/learner-events')) {
        return false;
      }
      try {
        return (request.postDataJSON() as { eventType?: string }).eventType === 'vocab.saved';
      } catch {
        return false;
      }
    },
    { timeout: 15_000 },
  );
}

async function saveGuidedWord(
  page: Page,
  word: (typeof GUIDED_WORDS)[number],
  count: number,
  onboardingUrl: string,
) {
  const trigger = page.getByRole('button', { name: `Look up ${word}`, exact: true }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const drawer = page.getByTestId('translation-drawer');
  await expect(drawer).toHaveClass(/translate-x-0/, { timeout: 5_000 });
  await expect(drawer.getByText(`meaning of ${word}`, { exact: false })).toBeVisible({
    timeout: 5_000,
  });
  await expect(drawer.getByTestId('onboarding-drawer-progress')).toContainText(
    `${count - 1}/3 ready`,
  );
  const savedEvent = waitForSavedEvent(page);
  await drawer.getByTestId('word-level-1').click();
  const savedResponse = await savedEvent;
  expect(savedResponse.status(), await savedResponse.text()).toBeLessThan(300);

  const current = await snapshot(page, onboardingUrl);
  expect(current.events.filter((event) => event.eventType === 'vocab.saved')).toHaveLength(count);
  await expect(
    page.getByText(`“${word}” added — ${count} of 3 review words ready`, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
}

async function translateGuidedPhrase(page: Page): Promise<void> {
  await expect(page.getByTestId('onboarding-coach-phrase')).toBeVisible();
  const translated = page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/translate') || response.request().method() !== 'POST') {
      return false;
    }
    try {
      return (response.request().postDataJSON() as { type?: string }).type === 'phrase';
    } catch {
      return false;
    }
  });

  const selectedPhrase = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('p')].find(
      (candidate) => candidate.querySelectorAll('[data-testid="reader-word"]').length >= 2,
    );
    if (!paragraph) throw new Error('No two-word reader paragraph found');
    const words = [...paragraph.querySelectorAll<HTMLElement>('[data-testid="reader-word"]')];
    const start = words[0].firstChild;
    const end = words[1].firstChild;
    if (!start || !end) throw new Error('Reader word text nodes missing');

    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent?.length || 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const phrase = selection?.toString().trim() || '';
    words[1].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return phrase;
  });

  expect(selectedPhrase).toContain(' ');
  const response = await translated;
  expect(response.status(), await response.text()).toBeLessThan(300);
  await expect(page.getByTestId('translation-drawer')).toContainText(
    `meaning of ${selectedPhrase}`,
  );
  await expect(page.getByTestId('onboarding-coach-save')).toBeVisible();
  await page.keyboard.press('Escape');
}

async function completeGuidedRound(
  page: Page,
  onboardingUrl = apiUrl('/api/onboarding'),
): Promise<void> {
  await saveGuidedWord(page, GUIDED_WORDS[0], 1, onboardingUrl);
  await translateGuidedPhrase(page);
  await saveGuidedWord(page, GUIDED_WORDS[1], 2, onboardingUrl);
  await saveGuidedWord(page, GUIDED_WORDS[2], 3, onboardingUrl);

  await expect(page.getByTestId('onboarding-coach-practice')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('start-onboarding-practice').click();
  await expect(page).toHaveURL(/\/practice\?onboarding=1$/, { timeout: 15_000 });

  for (const word of GUIDED_WORDS) {
    await expect(page.getByTestId('mc-option')).toHaveCount(4);
    // MC options expose their keyboard number as part of the accessible name
    // (for example "1 Ana"), so target the exact numbered answer rather than
    // relying on option order after shuffling.
    await page.getByRole('button', { name: new RegExp(`^\\d+\\s+${word}$`) }).click();
    await expect(page.getByRole('heading', { name: 'Correct!' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Next Sentence', exact: true }).click();
  }

  const summary = page.getByTestId('onboarding-summary');
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(
    summary.getByRole('heading', { name: 'First learning loop complete' }),
  ).toBeVisible();
  await expect(summary.getByText('3/3', { exact: true })).toBeVisible();
  await expect(page.getByTestId('onboarding-library')).toBeEnabled({ timeout: 10_000 });
}

test.describe('guided onboarding — selfhost', () => {
  test.skip(externalServer, 'source-mode test owns a directly resettable isolated selfhost DB');

  test.beforeEach(async ({ page }) => {
    resetSelfhostOnboarding();
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test.afterEach(() => {
    resetSelfhostOnboarding();
  });

  test('legacy existing user bypasses onboarding when a target language already exists', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.request.put(apiUrl('/api/settings/targetLanguage'), { data: { value: 'es' } });

    await page.goto('/');
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    await expect(page.getByText('Your Library').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('onboarding-resume')).toHaveCount(0);
    expect((await snapshot(page)).progress).toBeNull();

    await context.close();
  });

  test('skip persists preferences and never reopens setup', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
    await page.getByTestId('setup-language-es').click();
    await page.getByRole('button', { name: 'Intermediate', exact: true }).click();
    await page.getByRole('button', { name: 'Literature', exact: true }).click();
    await page.getByRole('button', { name: '30 min', exact: true }).click();
    await page.getByTestId('skip-guided-onboarding').click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });

    const current = await snapshot(page);
    expect(current.progress?.status).toBe('skipped');
    expect(current.progress?.currentStep).toBe('summary');
    expect(current.profile).toMatchObject({
      language: 'es',
      approximateLevel: 'intermediate',
      interests: ['literature'],
      dailyMinutes: 30,
    });
    expect(current.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['onboarding.profile_saved', 'onboarding.skipped']),
    );

    await page.goto('/setup');
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    await expect(page.getByTestId('onboarding-resume')).toHaveCount(0);
    await context.close();
  });

  test('an in-progress guide resumes in a clean browser context', async ({ browser }) => {
    const first = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const firstPage = await first.newPage();
    await mockReaderDefinitions(firstPage);
    const lessonId = await startSpanishGuide(firstPage);

    const second = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const secondPage = await second.newPage();
    await mockReaderDefinitions(secondPage);
    await secondPage.goto('/');
    const resume = secondPage.getByTestId('onboarding-resume');
    await expect(resume).toBeVisible({ timeout: 15_000 });
    await expect(resume).toContainText('Hola');
    await resume.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(secondPage).toHaveURL(new RegExp(`/read/${lessonId}\\?onboarding=1$`), {
      timeout: 15_000,
    });
    await expect(secondPage.getByTestId('onboarding-coach-lookup')).toBeVisible();

    await first.close();
    await second.close();
  });

  test('fresh Spanish learner completes reader → saved words → practice → summary', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await mockReaderDefinitions(page);
    await startSpanishGuide(page);
    await completeGuidedRound(page);

    const current = await snapshot(page);
    expect(current.progress?.status).toBe('completed');
    expect(current.progress?.currentStep).toBe('summary');
    expect(
      current.events.filter((event) => event.eventType === 'reader.term_looked_up'),
    ).toHaveLength(4);
    expect(current.events.filter((event) => event.eventType === 'vocab.saved')).toHaveLength(3);
    expect(
      current.events.filter((event) => event.eventType === 'practice.answer_submitted'),
    ).toHaveLength(3);
    expect(current.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['practice.round_completed', 'onboarding.completed']),
    );

    await page.getByTestId('onboarding-library').click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    await expect(page.getByTestId('onboarding-resume')).toHaveCount(0);

    const desktopNav = page.locator('aside');
    await expect(page.getByTestId('post-onboarding-practice-tip-desktop')).toContainText(
      'Go to the Practice tab to review words later.',
    );
    await desktopNav.getByRole('link', { name: 'Practice', exact: true }).click();
    await expect(page).toHaveURL('/practice');
    await expect(page.getByTestId('post-onboarding-vocab-tip-desktop')).toContainText(
      "Review the vocabulary you've interacted with in the Vocabulary tab.",
    );
    await desktopNav.getByRole('link', { name: 'Vocab', exact: true }).click();
    await expect(page).toHaveURL('/vocab');
    await expect(page.getByTestId('post-onboarding-anki-tip')).toContainText(
      'Click here if you need help setting up your Anki.',
    );

    const addonSetup = page.getByTestId('anki-addon-pill');
    if (await addonSetup.isVisible()) {
      await addonSetup.click();
    } else {
      await page.getByTestId('sync-with-anki').click();
    }
    await expect(page).toHaveURL(/\/settings#anki-integration$/);
    await expect(page.getByTestId('post-onboarding-anki-tip')).toHaveCount(0);
    await context.close();
  });

  test('coaching landmarks and actions work without a pointer', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await mockReaderDefinitions(page);
    await startSpanishGuide(page);

    const coach = page.getByRole('complementary', { name: 'Guided first lesson' });
    await expect(coach).toHaveAttribute('aria-live', 'polite');

    for (let i = 0; i < GUIDED_WORDS.length; i++) {
      const word = GUIDED_WORDS[i];
      const trigger = page.getByRole('button', { name: `Look up ${word}`, exact: true }).first();
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');
      await expect(page.getByRole('dialog', { name: `Definition of ${word}` })).toBeVisible();
      await expect(page.getByText(`meaning of ${word}`, { exact: false })).toBeVisible({
        timeout: 5_000,
      });

      const level = page.getByTestId('word-level-1');
      await level.focus();
      await expect(level).toBeFocused();
      const savedEvent = waitForSavedEvent(page);
      await level.press('Enter');
      const savedResponse = await savedEvent;
      expect(savedResponse.status(), await savedResponse.text()).toBeLessThan(300);
      const current = await snapshot(page);
      expect(current.events.filter((event) => event.eventType === 'vocab.saved')).toHaveLength(
        i + 1,
      );

      if (i < GUIDED_WORDS.length - 1) {
        await expect(page.getByTestId('onboarding-coach-phrase')).toContainText(
          `${i + 1} of 3 ready`,
        );
      } else {
        await expect(page.getByTestId('onboarding-coach-practice')).toBeVisible();
      }

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('translation-drawer')).toHaveClass(/translate-x-full/);
      await expect(trigger).not.toHaveAttribute('data-active-word', 'true');
    }

    const startPractice = page.getByTestId('start-onboarding-practice');
    await expect(startPractice).toBeVisible();
    await startPractice.focus();
    await expect(startPractice).toBeFocused();
    await startPractice.press('Enter');
    await expect(page).toHaveURL(/\/practice\?onboarding=1$/, { timeout: 15_000 });
    await context.close();
  });
});

interface CloudUser {
  context: BrowserContext;
  email: string;
}

async function cloudContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: UI_ORIGIN,
    storageState: { cookies: [], origins: [] },
  });
  await context.route('**/__env.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.__ENV__ = ${JSON.stringify({ API_URL: CLOUD_API, LECTOR_MODE: 'cloud' })};`,
    }),
  );
  return context;
}

async function verificationLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        let raw = '';
        try {
          raw = readFileSync(CLOUD_EMAILS, 'utf8');
        } catch {
          return false;
        }
        const message = raw
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { to: string; subject: string; text: string })
          .reverse()
          .find((candidate) => candidate.to === email && /verify/i.test(candidate.subject));
        link = message?.text.match(/https?:\/\/\S+/)?.[0];
        return !!link;
      },
      { timeout: 10_000, message: `no verification email for ${email}` },
    )
    .toBe(true);
  return link!;
}

async function signInCloud(context: BrowserContext, email: string): Promise<void> {
  const response = await context.request.post(`${CLOUD_API}/api/auth/sign-in/email`, {
    headers: AUTH_HEADERS,
    data: { email, password: CLOUD_PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function newCloudUser(browser: Browser, label: string): Promise<CloudUser> {
  const context = await cloudContext(browser);
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`;
  const signUp = await context.request.post(`${CLOUD_API}/api/auth/sign-up/email`, {
    headers: AUTH_HEADERS,
    data: { email, password: CLOUD_PASSWORD, name: label },
  });
  expect(signUp.status(), await signUp.text()).toBe(200);

  const verify = await context.request.get(await verificationLink(email), {
    headers: AUTH_HEADERS,
    maxRedirects: 0,
  });
  expect([200, 302]).toContain(verify.status());
  await signInCloud(context, email);
  return { context, email };
}

test.describe('guided onboarding — cloud accounts', () => {
  test.skip(externalServer, 'the dedicated :3462 cloud API is not booted in the Docker pass');

  test('fresh account completes the real recommended Spanish learning loop', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const user = await newCloudUser(browser, 'fresh-guide');
    const page = await user.context.newPage();
    await mockReaderDefinitions(page);
    const lessonId = await startSpanishGuide(page);
    await completeGuidedRound(page, `${CLOUD_API}/api/onboarding`);

    const current = await snapshot(page, `${CLOUD_API}/api/onboarding`);
    expect(current.progress).toMatchObject({
      status: 'completed',
      currentStep: 'summary',
      language: 'es',
      recommendedLessonId: lessonId,
    });
    expect(current.profile).toMatchObject({
      approximateLevel: 'beginner',
      interests: ['culture'],
      dailyMinutes: 20,
    });
    expect(
      current.events.filter((event) => event.eventType === 'practice.answer_submitted'),
    ).toHaveLength(3);
    expect(current.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['practice.round_completed', 'onboarding.completed']),
    );
    await user.context.close();
  });

  test('fresh account can skip and the terminal state survives sign-in on another device', async ({
    browser,
  }) => {
    const user = await newCloudUser(browser, 'skip-guide');
    const page = await user.context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup/, { timeout: 15_000 });
    await page.getByTestId('setup-language-es').click();
    await page.getByTestId('skip-guided-onboarding').click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    expect((await snapshot(page, `${CLOUD_API}/api/onboarding`)).progress?.status).toBe('skipped');
    await user.context.close();

    const nextDevice = await cloudContext(browser);
    await signInCloud(nextDevice, user.email);
    const nextPage = await nextDevice.newPage();
    await nextPage.goto('/setup');
    await expect(nextPage).toHaveURL('/', { timeout: 15_000 });
    await expect(nextPage.getByTestId('onboarding-resume')).toHaveCount(0);
    await nextDevice.close();
  });

  test('in-progress account resumes the same lesson on another device', async ({ browser }) => {
    const user = await newCloudUser(browser, 'resume-guide');
    const page = await user.context.newPage();
    await mockReaderDefinitions(page);
    const lessonId = await startSpanishGuide(page);
    await user.context.close();

    const nextDevice = await cloudContext(browser);
    await signInCloud(nextDevice, user.email);
    const nextPage = await nextDevice.newPage();
    await mockReaderDefinitions(nextPage);
    await nextPage.goto('/');
    const resume = nextPage.getByTestId('onboarding-resume');
    await expect(resume).toBeVisible({ timeout: 15_000 });
    await resume.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(nextPage).toHaveURL(new RegExp(`/read/${lessonId}\\?onboarding=1$`), {
      timeout: 15_000,
    });
    await expect(nextPage.getByTestId('onboarding-coach-lookup')).toBeVisible();
    await nextDevice.close();
  });

  test('existing account with a language and no onboarding row keeps its library path', async ({
    browser,
  }) => {
    const user = await newCloudUser(browser, 'existing-reader');
    const setting = await user.context.request.put(`${CLOUD_API}/api/settings/targetLanguage`, {
      data: { value: 'es' },
    });
    expect(setting.status(), await setting.text()).toBe(200);

    const page = await user.context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL('/', { timeout: 15_000 });
    await expect(page.getByText('Your Library').first()).toBeVisible({ timeout: 15_000 });
    expect((await snapshot(page, `${CLOUD_API}/api/onboarding`)).progress).toBeNull();
    await expect(page.getByTestId('onboarding-resume')).toHaveCount(0);
    await user.context.close();
  });
});
