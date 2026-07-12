import type { SQLQueryBindings } from 'bun:sqlite';
import { Hono } from 'hono';
import { db, CollectionGroupRow } from '../db';
import { getCurrentUserId } from '../lib/user';
import { randomUUID } from 'crypto';
import { entitlements, planLimitResponse } from '../lib/entitlements';
import { growingRowCheck, utf8Bytes } from '../lib/storage-limits';
import { validateSafeInteger } from '../lib/persisted-input';

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

  if (typeof name !== 'string' || !name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const normalizedName = name.trim();
  const id = randomUUID();
  const now = new Date().toISOString();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX(sortOrder), -1) as maxOrder FROM collection_groups WHERE userId = ?',
    )
    .get(userId) as { maxOrder: number };
  const nextOrder = maxOrder.maxOrder + 1;
  const nextOrderError = validateSafeInteger(nextOrder, 'sortOrder', { optional: false, min: 0 });
  if (nextOrderError) {
    return c.json({ error: 'Group sort order exceeds the safe integer range' }, 409);
  }

  const verdict = entitlements.reserveCount(
    userId,
    [
      { metric: 'maxCollectionGroups' },
      ...growingRowCheck('maxGroupNameBytes', utf8Bytes(normalizedName)),
    ],
    () => {
      db.prepare(
        'INSERT INTO collection_groups (id, name, sortOrder, createdAt, userId) VALUES (?, ?, ?, ?, ?)',
      ).run(id, normalizedName, nextOrder, now, userId);
    },
  );
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ id });
});

// PUT /api/groups/:id - Update a group
app.put('/:id', async (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = db
    .prepare('SELECT name FROM collection_groups WHERE id = ? AND userId = ?')
    .get(id, userId) as { name: string } | undefined;

  const updates: string[] = [];
  const values: SQLQueryBindings[] = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.sortOrder !== undefined) {
    const sortOrderError = validateSafeInteger(body.sortOrder, 'sortOrder', { min: 0 });
    if (sortOrderError) return c.json({ error: sortOrderError }, 400);
    updates.push('sortOrder = ?');
    values.push(body.sortOrder);
  }

  if (updates.length === 0) {
    return c.json({ success: true });
  }

  values.push(id);
  values.push(userId);
  const checks =
    body.name !== undefined && existing
      ? growingRowCheck('maxGroupNameBytes', utf8Bytes(body.name.trim()), utf8Bytes(existing.name))
      : [];
  const verdict = entitlements.reserveCount(userId, checks, () => {
    db.prepare(
      `UPDATE collection_groups SET ${updates.join(', ')} WHERE id = ? AND userId = ?`,
    ).run(...values);
  });
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json({ success: true });
});

// DELETE /api/groups/:id - Delete a group (its collections become ungrouped)
app.delete('/:id', (c) => {
  const userId = getCurrentUserId(c);
  const id = c.req.param('id');
  // Manually ungroup collections — SQLite's FK ON DELETE SET NULL only fires
  // with PRAGMA foreign_keys = ON, which isn't enabled here.
  db.prepare('UPDATE collections SET groupId = NULL WHERE groupId = ? AND userId = ?').run(
    id,
    userId,
  );
  db.prepare('DELETE FROM collection_groups WHERE id = ? AND userId = ?').run(id, userId);
  return c.json({ success: true });
});

export default app;
