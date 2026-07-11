import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, CollectionGroupRow } from '../db';
import { getCurrentUserId } from '../lib/user';
import { randomUUID } from 'crypto';

const app = new Hono();

// GET /api/groups - List all groups.
//
// Groups are language-agnostic containers (collection_groups has no language
// column) — language lives on the collections within. We return a total
// collection count (across ALL languages) per group so the library can tell a
// brand-new empty group, which stays visible so it can be populated, from a
// group whose collections all belong to other languages, which is hidden in the
// active language.
app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.sortOrder, g.createdAt,
              COUNT(col.id) AS collectionCount
         FROM collection_groups g
         LEFT JOIN collections col ON col.groupId = g.id AND col.userId = g.userId
        WHERE g.userId = ?
        GROUP BY g.id
        ORDER BY g.sortOrder ASC`,
    )
    .all(userId) as Array<CollectionGroupRow & { collectionCount: number }>;

  return c.json(groups);
});

// POST /api/groups - Create a new group
app.post('/', async (c) => {
  const userId = getCurrentUserId(c);
  const { name } = await c.req.json();

  if (!name?.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM collection_groups WHERE userId = ?')
    .get(userId) as { maxOrder: number };

  db.prepare('INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name.trim(),
    maxOrder.maxOrder + 1,
    now,
    userId,
  );

  return c.json({ id });
});

// PUT /api/groups/:id - Update a group
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.sortOrder !== undefined) {
    updates.push('sortOrder = ?');
    values.push(body.sortOrder);
  }

  if (updates.length === 0) {
    return c.json({ success: true });
  }

  values.push(id);
  values.push(userId);
  db.prepare(`UPDATE collection_groups SET ${updates.join(', ')} WHERE id = ? AND userId = ?`).run(...values);

  return c.json({ success: true });
});

// DELETE /api/groups/:id - Delete a group (its collections become ungrouped)
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  // Manually ungroup collections — SQLite's FK ON DELETE SET NULL only fires
  // with PRAGMA foreign_keys = ON, which isn't enabled here.
  db.prepare('UPDATE collections SET groupId = NULL WHERE groupId = ? AND userId = ?').run(id, userId);
  db.prepare('DELETE FROM collection_groups WHERE id = ? AND userId = ?').run(id, userId);
  return c.json({ success: true });
});

export default app;
