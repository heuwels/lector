import '../test-guard';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../db';
import { authMiddleware } from '../lib/auth';
import tokens from './tokens';

// All rows minted here carry this name prefix so cleanup can't touch
// anything else (auth.test.ts uses 'test-token').
const NAME = 'tokens-route-test';

function cleanupTokens(): void {
  db.prepare('DELETE FROM api_tokens WHERE name LIKE ?').run(`${NAME}%`);
}

function createToken(payload: unknown) {
  return tokens.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('POST /api/tokens — creation validation (#326)', () => {
  beforeEach(cleanupTokens);
  afterEach(cleanupTokens);

  test('creates a token with defaults: wildcard scope, no expiry', async () => {
    const res = await createToken({ name: NAME });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      token: string;
      scopes: string[];
      expiresAt: string | null;
    };
    expect(body.token).toMatch(/^ltr_/);
    expect(body.scopes).toEqual(['*']);
    expect(body.expiresAt).toBeNull();

    const row = db
      .prepare('SELECT scopes, expiresAt FROM api_tokens WHERE id = ?')
      .get(body.id) as { scopes: string; expiresAt: string | null };
    expect(JSON.parse(row.scopes)).toEqual(['*']);
    expect(row.expiresAt).toBeNull();
  });

  test('accepts a future expiry and stores it as canonical ISO', async () => {
    const res = await createToken({ name: NAME, expiresAt: '2030-01-05T10:20:30+00:00' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; expiresAt: string };
    expect(body.expiresAt).toBe('2030-01-05T10:20:30.000Z');

    const row = db.prepare('SELECT expiresAt FROM api_tokens WHERE id = ?').get(body.id) as {
      expiresAt: string;
    };
    expect(row.expiresAt).toBe('2030-01-05T10:20:30.000Z');
  });

  test('canonicalizes a date-only expiry', async () => {
    const res = await createToken({ name: NAME, expiresAt: '2030-06-01' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { expiresAt: string }).expiresAt).toBe(
      '2030-06-01T00:00:00.000Z',
    );
  });

  test('explicit null expiry is accepted and stored as NULL', async () => {
    const res = await createToken({ name: NAME, expiresAt: null });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { expiresAt: string | null }).expiresAt).toBeNull();
  });

  test.each([
    ['a past date', '2020-01-01T00:00:00Z', 'expiresAt must be in the future'],
    ['an unparseable string', 'soon', 'expiresAt must be an ISO date or null'],
    ['a number', 1893456000000, 'expiresAt must be an ISO date or null'],
    [
      'an over-long string',
      `2030-01-01T00:00:00.000Z${' '.repeat(64)}`,
      'expiresAt must be an ISO date or null',
    ],
  ])('rejects %s as expiry', async (_label, expiresAt, error) => {
    const res = await createToken({ name: NAME, expiresAt });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
    expect(db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE name = ?').get(NAME)).toEqual({
      n: 0,
    });
  });

  test.each([
    ['an empty array', []],
    ['a non-string element', ['collections:read', 42]],
    ['an unknown scope', ['superadmin']],
    ['a non-array value', 'collections:read'],
  ])('rejects %s as scopes', async (_label, scopes) => {
    const res = await createToken({ name: NAME, scopes });
    expect(res.status).toBe(400);
  });

  test('deduplicates scopes before persisting', async () => {
    const res = await createToken({ name: NAME, scopes: ['vocab:read', 'vocab:read'] });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { scopes: string[] }).scopes).toEqual(['vocab:read']);
  });

  test.each([
    ['a missing name', {}],
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['a non-string name', { name: 42 }],
  ])('rejects %s', async (_label, payload) => {
    const res = await createToken(payload);
    expect(res.status).toBe(400);
  });

  test('rejects a malformed JSON body with 400, not 500', async () => {
    const res = await tokens.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Malformed JSON body');
  });

  test.each([
    ['a JSON null body', 'null'],
    ['a JSON array body', '[]'],
    ['a JSON scalar body', '"token please"'],
  ])('rejects %s with 400', async (_label, raw) => {
    const res = await tokens.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Body must be a JSON object');
  });
});

describe('token write/read symmetry — a minted token authorizes exactly its scopes', () => {
  beforeEach(cleanupTokens);
  afterEach(cleanupTokens);

  test('a route-created token authenticates through the auth middleware', async () => {
    const minted = await createToken({
      name: NAME,
      scopes: ['collections:read'],
      expiresAt: '2031-01-01T00:00:00Z',
    });
    expect(minted.status).toBe(201);
    const { token } = (await minted.json()) as { token: string };

    const probe = new Hono();
    probe.use('/api/*', authMiddleware);
    probe.get('/api/collections', (c) => c.json({ ok: true }));
    probe.post('/api/collections', (c) => c.json({ ok: true }));

    const read = await probe.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(read.status).toBe(200);

    const write = await probe.request('/api/collections', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(write.status).toBe(403);
  });
});

describe('GET /api/tokens — list survives corrupt scope metadata', () => {
  beforeEach(cleanupTokens);
  afterEach(cleanupTokens);

  test('a corrupt row lists with empty scopes instead of failing the request', async () => {
    const minted = await createToken({ name: NAME, scopes: ['anki:*'] });
    const { id } = (await minted.json()) as { id: string };
    db.prepare('UPDATE api_tokens SET scopes = ? WHERE id = ?').run('not-json{', id);

    const res = await tokens.request('/');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; scopes: string[] }>;
    const corrupt = rows.find((row) => row.id === id);
    expect(corrupt).toBeDefined();
    expect(corrupt?.scopes).toEqual([]);
  });
});
