import { Hono } from 'hono';
import { randomUUID, randomBytes } from 'crypto';
import { getCurrentUserId } from '../lib/user';
import { db, ApiTokenRow } from '../db';
import { hashToken } from '../lib/crypto';

const VALID_SCOPES = new Set([
  '*',
  'collections:read', 'collections:write', 'collections:*',
  'vocab:read', 'vocab:write', 'vocab:*',
  'stats:read', 'stats:write', 'stats:*',
  'settings:read', 'settings:write', 'settings:*',
  'data:export', 'data:import', 'data:*',
  'chat:read', 'chat:write', 'chat:*',
]);

const app = new Hono();

function generateToken(): string {
  const bytes = randomBytes(32);
  const encoded = bytes.toString('base64url');
  return `ltr_${encoded}`;
}

// POST /api/tokens - Create a new token
app.post('/', async (c) => {
  const body = await c.req.json();
  const { name, scopes = ['*'], expiresAt } = body;

  if (!name || typeof name !== 'string') {
    return c.json({ error: 'Name is required' }, 400);
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    return c.json({ error: 'Scopes must be a non-empty array' }, 400);
  }

  const invalid = scopes.filter((s: string) => !VALID_SCOPES.has(s));
  if (invalid.length > 0) {
    return c.json({ error: `Invalid scopes: ${invalid.join(', ')}` }, 400);
  }

  const token = generateToken();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_tokens (id, name, tokenHash, scopes, createdAt, expiresAt, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, hashToken(token), JSON.stringify(scopes), now, expiresAt || null, getCurrentUserId(c));

  return c.json({
    id,
    name,
    token, // Plain token - returned ONCE
    scopes,
    createdAt: now,
    expiresAt: expiresAt || null,
  }, 201);
});

// GET /api/tokens - List all tokens (metadata only)
app.get('/', (c) => {
  const rows = db.prepare('SELECT id, name, scopes, createdAt, lastUsedAt, expiresAt FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC').all(getCurrentUserId(c)) as Omit<ApiTokenRow, 'tokenHash'>[];

  return c.json(rows.map(row => ({
    ...row,
    scopes: JSON.parse(row.scopes as string),
  })));
});

// POST /api/tokens/verify - Verify the current token
app.post('/verify', (c) => {
  const tokenId = c.get('tokenId');
  const tokenName = c.get('tokenName');
  const tokenScopes = c.get('tokenScopes');

  if (!tokenId) {
    return c.json({ valid: false, error: 'No token provided' }, 401);
  }

  return c.json({
    valid: true,
    id: tokenId,
    name: tokenName,
    scopes: tokenScopes,
  });
});

// DELETE /api/tokens/:id - Revoke a token
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND userId = ?').run(id, getCurrentUserId(c));

  if (result.changes === 0) {
    return c.json({ error: 'Token not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
