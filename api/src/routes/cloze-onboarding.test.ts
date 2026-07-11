import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db } from '../db';

const { default: app } = await import('./cloze');
const TS = '2026-01-01T00:00:00.000Z';

function reset() {
  db.prepare("DELETE FROM clozeSentences WHERE id LIKE 'onboarding:onboard-%'").run();
  db.prepare("DELETE FROM vocab WHERE id LIKE 'onboard-%'").run();
}

function seedVocab(
  id: string,
  text: string,
  options: { userId?: string; type?: 'word' | 'phrase'; state?: string } = {},
) {
  db.prepare(
    `INSERT INTO vocab
       (userId, id, text, type, sentence, translation, state, stateUpdatedAt, language, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'es', ?)`,
  ).run(
    options.userId ?? 'local',
    id,
    text,
    options.type ?? 'word',
    `${text} aparece aquí.`,
    'meaning',
    options.state ?? 'new',
    TS,
    TS,
  );
}

function create(body: Record<string, unknown>) {
  return app.request('/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'es', ...body }),
  });
}

describe('onboarding mined cloze queue', () => {
  beforeEach(reset);
  afterEach(reset);

  test('creates a punctuation-insensitive deterministic card and preserves review state on retry', async () => {
    seedVocab('onboard-hola', 'Hola');
    const first = await create({
      vocabId: 'onboard-hola',
      word: 'hola',
      sentence: '¡Hola, mundo!',
      translation: 'Hello, world!',
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      id: 'onboarding:onboard-hola',
      source: 'mined',
      collection: 'mined',
      vocabEntryId: 'onboard-hola',
      clozeWord: 'Hola',
      clozeIndex: 0,
      language: 'es',
    });

    db.prepare(
      `UPDATE clozeSentences SET masteryLevel = 50, reviewCount = 3, timesCorrect = 2
       WHERE userId = 'local' AND id = 'onboarding:onboard-hola'`,
    ).run();
    const retry = await create({
      vocabId: 'onboard-hola',
      word: 'Hola',
      sentence: 'Ayer dije: hola.',
      clozeWord: 'hola',
      translation: 'Yesterday I said hello.',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      sentence: 'Ayer dije: hola.',
      clozeIndex: 2,
      masteryLevel: 50,
      reviewCount: 3,
      timesCorrect: 2,
    });
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM clozeSentences WHERE id = 'onboarding:onboard-hola'")
          .get() as { n: number }
      ).n,
    ).toBe(1);
  });

  test('returns only exact requested cards, in requested vocab order', async () => {
    seedVocab('onboard-uno', 'uno');
    seedVocab('onboard-dos', 'dos');
    await create({
      vocabId: 'onboard-uno',
      word: 'uno',
      sentence: 'Veo uno.',
      translation: 'I see one.',
    });
    await create({
      vocabId: 'onboard-dos',
      word: 'dos',
      sentence: 'Veo dos.',
      translation: 'I see two.',
    });

    const response = await app.request(
      '/onboarding?vocabIds=onboard-dos,onboard-missing,onboard-uno&language=es',
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as Array<{ vocabEntryId: string }>).map((row) => row.vocabEntryId),
    ).toEqual(['onboard-dos', 'onboard-uno']);
  });

  test('rejects phrases, terminal vocabulary, missing sentence tokens, and foreign rows', async () => {
    seedVocab('onboard-phrase', 'buen día', { type: 'phrase' });
    seedVocab('onboard-known', 'hola', { state: 'known' });
    seedVocab('onboard-foreign', 'secreto', { userId: 'intruder' });

    expect(
      (
        await create({
          vocabId: 'onboard-phrase',
          word: 'buen día',
          sentence: 'Buen día.',
          translation: 'Good day.',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await create({
          vocabId: 'onboard-known',
          word: 'hola',
          sentence: 'Hola.',
          translation: 'Hello.',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await create({
          vocabId: 'onboard-foreign',
          word: 'secreto',
          sentence: 'Un secreto.',
          translation: 'A secret.',
        })
      ).status,
    ).toBe(404);

    seedVocab('onboard-gato', 'gato');
    expect(
      (
        await create({
          vocabId: 'onboard-gato',
          word: 'gato',
          sentence: 'Veo un perro.',
          translation: 'I see a dog.',
        })
      ).status,
    ).toBe(400);
    expect((await app.request('/onboarding?vocabIds=&language=es')).status).toBe(400);
  });
});
