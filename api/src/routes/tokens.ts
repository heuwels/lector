import { Hono } from 'hono';
import { randomUUID, randomBytes } from 'crypto';
import { getCurrentUserId } from '../lib/user';
import { db, ApiTokenRow } from '../db';
import { VALID_SCOPES } from '../lib/auth';
import { hashToken } from '../lib/crypto';
import { entitlements, planLimitResponse } from '../lib/entitlements';
import { growingRowCheck, utf8Bytes } from '../lib/storage-limits';

const app = new Hono();
const MAX_TOKEN_NAME_BYTES = 1024;

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
  const normalizedName = name.trim();
  if (!normalizedName) return c.json({ error: 'Name is required' }, 400);
  if (utf8Bytes(normalizedName) > MAX_TOKEN_NAME_BYTES) {
    return c.json({ error: `Name is too large (max ${MAX_TOKEN_NAME_BYTES} bytes)` }, 400);
  }

  if (!Array.isArray(scopes) || scopes.length === 0) {
    return c.json({ error: 'Scopes must be a non-empty array' }, 400);
  }

  if (scopes.length > VALID_SCOPES.size) {
    return c.json({ error: 'Too many scopes' }, 400);
  }

  const invalid = scopes.filter((s: string) => !VALID_SCOPES.has(s));
  if (invalid.length > 0) {
    return c.json({ error: `Invalid scopes: ${invalid.join(', ')}` }, 400);
  }
  const normalizedScopes = [...new Set(scopes as string[])];
  if (
    expiresAt !== undefined &&
    expiresAt !== null &&
    (typeof expiresAt !== 'string' || expiresAt.length > 64 || Number.isNaN(Date.parse(expiresAt)))
  ) {
    return c.json({ error: 'expiresAt must be an ISO date or null' }, 400);
  }

  const token = generateToken();
  const id = randomUUID();
  const now = new Date().toISOString();

  const userId = getCurrentUserId(c);
  const verdict = entitlements.reserveCount(
    userId,
    [
      { metric: 'maxApiTokens' },
      ...growingRowCheck('maxApiTokenNameBytes', utf8Bytes(normalizedName)),
    ],
    () => {
      db.prepare(
        `
        INSERT INTO api_tokens (id, name, tokenHash, scopes, createdAt, expiresAt, userId)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        normalizedName,
        hashToken(token),
        JSON.stringify(normalizedScopes),
        now,
        expiresAt || null,
        userId,
      );
    },
  );
  if (!verdict.allowed) return planLimitResponse(c, verdict);

  return c.json(
    {
      id,
      name: normalizedName,
      token, // Plain token - returned ONCE
      scopes: normalizedScopes,
      createdAt: now,
      expiresAt: expiresAt || null,
    },
    201,
  );
});

// GET /api/tokens - List all tokens (metadata only)
app.get('/', (c) => {
  const rows = db
    .prepare(
      'SELECT id, name, scopes, createdAt, lastUsedAt, expiresAt FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC',
    )
    .all(getCurrentUserId(c)) as Omit<ApiTokenRow, 'tokenHash'>[];

  return c.json(
    rows.map((row) => ({
      ...row,
      scopes: JSON.parse(row.scopes as string),
    })),
  );
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
  const result = db
    .prepare('DELETE FROM api_tokens WHERE id = ? AND userId = ?')
    .run(id, getCurrentUserId(c));

  if (result.changes === 0) {
    return c.json({ error: 'Token not found' }, 404);
  }

  return c.json({ success: true });
});

export default app;
