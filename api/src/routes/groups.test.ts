import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '../db';
import app from '../routes/groups';

// collection_groups is language-agnostic: a group can hold collections of
// different languages, and language lives on the collection, not the group.
// GET /api/groups returns a per-group collectionCount (total across ALL
// languages) so the library can distinguish a brand-new empty group from one
// whose collections all belong to other languages.

function reset() {
  db.prepare('DELETE FROM collections').run();
  db.prepare('DELETE FROM collection_groups').run();
}

function insertGroup(id: string, sortOrder: number, name = `Group ${id}`) {
  db.prepare('INSERT INTO collection_groups (id, name, sortOrder, createdAt) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    sortOrder,
    '2026-01-01T00:00:00Z',
  );
}

function insertCollection(id: string, groupId: string | null, language: string) {
  db.prepare(
    `INSERT INTO collections (id, title, author, coverUrl, groupId, sortOrder, language, createdAt, lastReadAt)
     VALUES (?, ?, 'Author', NULL, ?, 0, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run(id, `Title ${id}`, groupId, language);
}

interface GroupResult {
  id: string;
  name: string;
  collectionCount: number;
}

describe('groups route — language-agnostic groups', () => {
  beforeEach(reset);
  afterEach(reset);

  test('GET / returns every group ordered by sortOrder, regardless of collection language', async () => {
    insertGroup('g2', 1, 'Second');
    insertGroup('g1', 0, 'First');
    insertCollection('c-de', 'g1', 'de'); // g1 holds only a German collection…

    const groups = (await (await app.request('/')).json()) as GroupResult[];

    // …it is still returned (groups aren't filtered by language), ordered by sortOrder.
    expect(groups.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  test('GET / counts collections across ALL languages (collectionCount)', async () => {
    insertGroup('g1', 0);
    insertCollection('a1', 'g1', 'af');
    insertCollection('a2', 'g1', 'af');
    insertCollection('d1', 'g1', 'de');

    const [g1] = (await (await app.request('/')).json()) as GroupResult[];

    expect(g1.collectionCount).toBe(3);
  });

  test('GET / distinguishes a brand-new empty group (0) from an other-language-only group (>0)', async () => {
    insertGroup('only-de', 0);
    insertGroup('empty', 1);
    insertCollection('d1', 'only-de', 'de');

    const byId = Object.fromEntries(
      ((await (await app.request('/')).json()) as GroupResult[]).map((g) => [g.id, g.collectionCount]),
    );

    // These counts are what let the library keep `empty` visible (so it can be
    // populated) while hiding `only-de` in an Afrikaans session.
    expect(byId['empty']).toBe(0);
    expect(byId['only-de']).toBe(1);
  });
});
