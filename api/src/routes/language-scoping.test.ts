import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';

const { default: collectionsApp } = await import('../routes/collections');
const { default: lessonsApp } = await import('../routes/lessons');

const TS = '2026-01-01T00:00:00Z';

function reset() {
  db.prepare('DELETE FROM lessons').run();
  db.prepare('DELETE FROM collections').run();
}

function seedCollection(id: string, language: string) {
  db.prepare(
    'INSERT INTO collections (id, title, author, language, createdAt, lastReadAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, 'C', 'A', language, TS, TS);
}

async function addLesson(collectionId: string): Promise<string> {
  const res = await collectionsApp.request(`/${collectionId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'L', textContent: 'x' }),
  });
  return ((await res.json()) as { id: string }).id;
}

describe('lesson language partitioning', () => {
  beforeEach(reset);
  afterEach(reset);

  test('a lesson added to a collection inherits the collection language', async () => {
    seedCollection('c_de', 'de');
    const id = await addLesson('c_de');
    const lang = (db.prepare('SELECT language FROM lessons WHERE id = ?').get(id) as { language: string }).language;
    expect(lang).toBe('de'); // inherited from the 'de' collection, not the 'af' column default
  });

  test('by-id lesson routes are language-scoped — a cross-language id 404s / no-ops', async () => {
    seedCollection('c_de', 'de');
    const id = await addLesson('c_de');

    expect((await lessonsApp.request(`/${id}?language=af`)).status).toBe(404); // wrong language
    expect((await lessonsApp.request(`/${id}?language=de`)).status).toBe(200); // right language

    // DELETE under the wrong language is a no-op; under the right one it removes the row.
    await lessonsApp.request(`/${id}?language=af`, { method: 'DELETE' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE id = ?').get(id) as { n: number }).n).toBe(1);
    await lessonsApp.request(`/${id}?language=de`, { method: 'DELETE' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE id = ?').get(id) as { n: number }).n).toBe(0);
  });
});
