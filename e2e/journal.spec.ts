import { test, expect } from '@playwright/test';
import { apiUrl } from './api';

const TEST_PREFIX = '2099'; // Far future dates to avoid conflicts

/** Today in this machine's zone — the zone the API falls back to for day windows. */
function localToday(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

test.describe('Journal', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Clean up any test entries
    const res = await page.request.get(apiUrl('/api/journal?limit=100'));
    const entries = await res.json();
    for (const e of entries) {
      if (e.entryDate.startsWith(TEST_PREFIX)) {
        await page.request.delete(apiUrl(`/api/journal/${e.id}`));
      }
    }
  });

  test('should navigate to journal page', async ({ page }) => {
    await page.goto('/journal');
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal' })).toBeVisible();
  });

  test('should show journal in navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await expect(page.getByRole('link', { name: 'Journal' })).toBeVisible();
  });

  test('should show New Entry button', async ({ page }) => {
    await page.goto('/journal');
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: 'New Entry' })).toBeVisible();
  });

  test('should create and save a draft entry via API', async ({ page }) => {
    const createRes = await page.request.post(apiUrl('/api/journal'), {
      data: { body: "Dit is 'n toets inskrywing.", entryDate: '2099-01-01' },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id, entryDate } = await createRes.json();
    expect(entryDate).toBe('2099-01-01');

    const getRes = await page.request.get(apiUrl(`/api/journal/${id}`));
    const entry = await getRes.json();
    expect(entry.body).toBe("Dit is 'n toets inskrywing.");
    expect(entry.status).toBe('draft');
    expect(entry.wordCount).toBe(5);
    expect(entry.corrections).toBeNull();

    await page.request.delete(apiUrl(`/api/journal/${id}`));
  });

  test('should allow multiple entries per day', async ({ page }) => {
    const res1 = await page.request.post(apiUrl('/api/journal'), {
      data: { body: 'Eerste inskrywing.', entryDate: '2099-01-01' },
    });
    const res2 = await page.request.post(apiUrl('/api/journal'), {
      data: { body: 'Tweede inskrywing.', entryDate: '2099-01-01' },
    });
    expect(res1.ok()).toBeTruthy();
    expect(res2.ok()).toBeTruthy();

    const { id: id1 } = await res1.json();
    const { id: id2 } = await res2.json();
    expect(id1).not.toBe(id2);

    const listRes = await page.request.get(apiUrl('/api/journal?date=2099-01-01'));
    const entries = await listRes.json();
    expect(entries.length).toBe(2);

    await page.request.delete(apiUrl(`/api/journal/${id1}`));
    await page.request.delete(apiUrl(`/api/journal/${id2}`));
  });

  test('should delete an entry', async ({ page }) => {
    const createRes = await page.request.post(apiUrl('/api/journal'), {
      data: { body: 'Gaan verwyder word.', entryDate: '2099-01-01' },
    });
    const { id } = await createRes.json();

    const deleteRes = await page.request.delete(apiUrl(`/api/journal/${id}`));
    expect(deleteRes.ok()).toBeTruthy();

    const getRes = await page.request.get(apiUrl(`/api/journal/${id}`));
    expect(getRes.status()).toBe(404);
  });

  test('should open editor on New Entry click', async ({ page }) => {
    await page.goto('/journal');
    await page.waitForLoadState('load');

    await page.getByRole('button', { name: 'New Entry' }).click();

    await expect(page.getByPlaceholder(/journal entry in/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Draft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  });

  test('should save draft via UI and show in history', async ({ page }) => {
    await page.goto('/journal');
    await page.waitForLoadState('load');

    await page.getByRole('button', { name: 'New Entry' }).click();

    const textarea = page.getByPlaceholder(/journal entry in/i);
    await textarea.fill('Ek het vandag geoefen.');
    await page.getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Draft').first()).toBeVisible();

    // Clean up
    const today = new Date().toISOString().split('T')[0];
    const res = await page.request.get(apiUrl(`/api/journal?date=${today}`));
    const entries = await res.json();
    for (const e of entries) {
      if (e.body === 'Ek het vandag geoefen.') {
        await page.request.delete(apiUrl(`/api/journal/${e.id}`));
      }
    }
  });

  test('should show draft entries with Draft badge in history', async ({ page }) => {
    const createRes = await page.request.post(apiUrl('/api/journal'), {
      data: {
        body: 'Gister ek het na die stoor gaan.',
        entryDate: '2099-02-01',
      },
    });
    const { id } = await createRes.json();

    await page.goto('/journal');
    await page.waitForLoadState('load');

    await expect(page.getByText('Draft').first()).toBeVisible();

    await expect(page.getByText('Gister ek het na die stoor gaan.').first()).toBeVisible();

    await page.getByText('Gister ek het na die stoor gaan.').first().click();
    await expect(page.getByPlaceholder(/journal entry in/i)).toBeVisible();

    await page.request.delete(apiUrl(`/api/journal/${id}`));
  });

  test('saves without a correction call', async ({ page }) => {
    let correctCalls = 0;
    await page.route('**/api/journal/*/correct', async (route) => {
      correctCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ correctedBody: 'x', corrections: [] }),
      });
    });

    await page.goto('/journal');
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'New Entry' }).click();
    await page.getByPlaceholder(/journal entry in/i).fill("Vandag was 'n stil dag.");
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Get AI correction')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Perfect')).toHaveCount(0);
    expect(correctCalls).toBe(0);

    const today = new Date().toISOString().split('T')[0];
    const res = await page.request.get(apiUrl(`/api/journal?date=${today}`));
    const entries = await res.json();
    for (const e of entries) {
      if (e.body === "Vandag was 'n stil dag.") {
        expect(e.status).toBe('submitted');
        expect(e.corrections).toBeNull();
        await page.request.delete(apiUrl(`/api/journal/${e.id}`));
      }
    }
  });

  test('word counts cover saved entries only, on the journal and the stats page', async ({
    page,
  }) => {
    const before = await page.request.get(apiUrl('/api/journal?limit=200'));
    for (const e of await before.json()) {
      await page.request.delete(apiUrl(`/api/journal/${e.id}`));
    }

    // The month window is a calendar month in the API's zone, not UTC.
    const created = await page.request.post(apiUrl('/api/journal'), {
      data: { body: 'Een twee drie vier vyf', entryDate: localToday() },
    });
    const { id } = await created.json();
    const saved = await page.request.put(apiUrl(`/api/journal/${id}`), {
      data: { body: 'Een twee drie vier vyf', status: 'submitted' },
    });
    expect(saved.ok()).toBeTruthy();

    // A draft stays out of every total until the learner saves it.
    await page.request.post(apiUrl('/api/journal'), {
      data: { body: 'Nog drie woorde', entryDate: localToday() },
    });

    await page.goto('/journal');
    await page.waitForLoadState('load');
    await expect(page.getByTestId('journal-word-counts')).toHaveText(
      '5 words this month · 5 this year · 5 all time',
      { timeout: 10000 },
    );

    await page.goto('/stats');
    await page.waitForLoadState('load');
    const journalStats = page.getByTestId('journal-word-stats');
    await expect(journalStats).toBeVisible({ timeout: 20000 });
    await expect(journalStats.getByText('Journal words this month')).toBeVisible();
    await expect(journalStats.getByText('5').first()).toBeVisible();

    const after = await page.request.get(apiUrl('/api/journal?limit=200'));
    for (const e of await after.json()) {
      await page.request.delete(apiUrl(`/api/journal/${e.id}`));
    }
  });

  test('full journey: create, save draft, save, correct from the view', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0];

    const existing = await page.request.get(apiUrl(`/api/journal?date=${today}`));
    const existingEntries = await existing.json();
    for (const e of existingEntries) {
      await page.request.delete(apiUrl(`/api/journal/${e.id}`));
    }

    let correctCalls = 0;
    await page.route('**/api/journal/*/correct', async (route) => {
      correctCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          correctedBody: 'Gister het ek na die winkel gegaan. Ek het baie dinge gekoop.',
          corrections: [
            {
              original: 'Gister ek het',
              corrected: 'Gister het ek',
              explanation: 'V2 word order',
              type: 'word_order',
            },
            {
              original: 'stoor',
              corrected: 'winkel',
              explanation: 'Word choice',
              type: 'word_choice',
            },
          ],
          critique: {
            strengths: ['You told a full story.'],
            weaknesses: ['Word order is still unstable.'],
          },
        }),
      });
    });

    // The mocked /correct never reaches the DB, so the real PUT would refuse a
    // revision. Capture the save instead. The API test covers persistence.
    const revisionSaves: { revision?: string }[] = [];
    await page.route('**/api/journal/*', async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const data = request.postDataJSON() as { revision?: string } | null;
        if (data && typeof data.revision === 'string') {
          revisionSaves.push(data);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
          });
          return;
        }
      }
      await route.fallback();
    });

    await page.goto('/journal');
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'New Entry' }).click();

    await page
      .getByPlaceholder(/journal entry in/i)
      .fill('Gister ek het na die stoor gaan. Ek het koop baie dinge.');

    await page.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 5000 });

    await page.goto('/vocab');
    await page.waitForLoadState('load');

    await page.goto('/journal');
    await page.waitForLoadState('load');
    await expect(page.getByText('Gister ek het na die stoor gaan.').first()).toBeVisible();

    await page.getByText('Gister ek het na die stoor gaan.').first().click();
    await expect(page.getByPlaceholder(/journal entry in/i)).toHaveValue(
      'Gister ek het na die stoor gaan. Ek het koop baie dinge.',
    );

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Get AI correction' })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole('button', { name: 'Get AI correction' }).click();
    await expect(page.getByRole('button', { name: 'Corrections', exact: true })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole('button', { name: 'Corrections', exact: true }).click();
    await expect(page.getByText('2 corrections:')).toBeVisible();

    await page.getByRole('button', { name: 'Critique', exact: true }).click();
    await expect(page.getByText('You told a full story.')).toBeVisible();
    await expect(page.getByText('Word order is still unstable.')).toBeVisible();

    await page.getByRole('button', { name: 'Revision', exact: true }).click();
    await expect(page.getByPlaceholder(/Write the page again/i)).toBeVisible();

    // All three texts on one face: the original, the correction, the revision.
    await expect(page.getByText('Your text')).toBeVisible();
    await expect(page.getByText('Corrected', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Gister het ek na die winkel gegaan. Ek het baie dinge gekoop.'),
    ).toBeVisible();

    await page
      .getByPlaceholder(/Write the page again/i)
      .fill('Gister het ek na die winkel gegaan. Ek het baie dinge gekoop.');
    await page.getByRole('button', { name: 'Save revision' }).click();
    await expect(page.getByText('Revision saved')).toBeVisible({ timeout: 5000 });

    // The revision is text the learner writes. It never runs the model again.
    expect(revisionSaves).toHaveLength(1);
    expect(revisionSaves[0].revision).toBe(
      'Gister het ek na die winkel gegaan. Ek het baie dinge gekoop.',
    );
    expect(correctCalls).toBe(1);

    const apiRes = await page.request.get(apiUrl(`/api/journal?date=${today}`));
    const entries = await apiRes.json();
    for (const e of entries) {
      if (e.body.startsWith('Gister ek het na die stoor gaan.')) {
        await page.request.delete(apiUrl(`/api/journal/${e.id}`));
      }
    }
  });
});
