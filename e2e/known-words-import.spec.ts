import { expect, test, type Page } from '@playwright/test';
import { apiUrl } from './api';

interface VocabRow {
  id: string;
  text: string;
  type: string;
  state: string;
  translation: string;
  sentence: string;
}

async function vocabByText(page: Page, text: string): Promise<VocabRow | undefined> {
  const res = await page.request.get(
    apiUrl(`/api/vocab?language=af&text=${encodeURIComponent(text)}`),
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json())[0];
}

async function uploadCsv(page: Page, csv: string) {
  await page.goto('/settings');
  await page.getByTestId('known-words-import-file').setInputFiles({
    name: 'lingq.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
}

test.describe('LingQ known-word import', () => {
  test('maps phrase, meaning, and multi-word terms from a LingQ site export', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const word = `lingqwoord${suffix}`;
    const phrase = `lingq frase ${suffix}`;
    const csv = [
      'term,phrase,tag1,tag2,tag3,tag4,tag5,tag6,tag7,tag8,tag9,tag10,tag11,tag12,meaninglanguage1,meaning1',
      `${word},"Hy sê ""${word}"", nie waar nie?",Noun,,,,,,,,,,,,en,"word, term"`,
      `${phrase},"Die ${phrase}
oor twee reëls.",,,,,,,,,,,,,en,a phrase`,
    ].join('\n');

    const created: string[] = [];
    try {
      await uploadCsv(page, csv);
      await expect(
        page.getByText('Imported 2 words from LingQ: 0 known, 2 learning.'),
      ).toBeVisible();

      const wordRow = await vocabByText(page, word);
      expect(wordRow).toMatchObject({
        type: 'word',
        state: 'level1',
        translation: 'word, term',
        sentence: `Hy sê "${word}", nie waar nie?`,
      });
      created.push(wordRow!.id);

      const phraseRow = await vocabByText(page, phrase);
      expect(phraseRow).toMatchObject({
        type: 'phrase',
        state: 'level1',
        translation: 'a phrase',
        sentence: `Die ${phrase}\noor twee reëls.`,
      });
      created.push(phraseRow!.id);
    } finally {
      for (const id of created) await page.request.delete(apiUrl(`/api/vocab/${id}`));
    }
  });

  test('fills a blank translation and sentence on an existing entry without lowering its state', async ({
    page,
  }) => {
    const text = `lingqbestaan${Date.now().toString(36)}`;
    const id = `e2e-lingq-${text}`;
    const seed = await page.request.post(apiUrl('/api/vocab'), {
      data: {
        id,
        text,
        type: 'word',
        sentence: '',
        translation: '',
        state: 'level3',
        reviewCount: 0,
        pushedToAnki: false,
        language: 'af',
      },
    });
    expect(seed.ok()).toBeTruthy();

    try {
      await uploadCsv(
        page,
        `"term","hint","status","sentence"\n"${text}","existing","1","Ek ken ${text}."`,
      );
      await expect(page.getByText(/Imported 1 words from LingQ/)).toBeVisible();

      expect(await vocabByText(page, text)).toMatchObject({
        id,
        state: 'level3',
        translation: 'existing',
        sentence: `Ek ken ${text}.`,
      });
    } finally {
      await page.request.delete(apiUrl(`/api/vocab/${id}`));
    }
  });
});
