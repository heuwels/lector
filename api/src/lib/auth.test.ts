import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { randomBytes, randomUUID } from 'crypto';
import { db } from '../db';
import { authMiddleware } from './auth';
import { hashToken } from './crypto';

function createTestToken(scopes: string[] = ['*'], expiresAt?: string): string {
  const token = `ltr_${randomBytes(32).toString('base64url')}`;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO api_tokens (id, name, tokenHash, scopes, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, 'test-token', hashToken(token), JSON.stringify(scopes), new Date().toISOString(), expiresAt || null);
  return token;
}

function cleanupTokens(): void {
  db.prepare("DELETE FROM api_tokens WHERE name = 'test-token'").run();
}

function buildApp(): Hono {
  const app = new Hono();
  app.use('/api/*', authMiddleware);
  app.get('/api/collections', (c) => c.json({ ok: true }));
  app.post('/api/collections', (c) => c.json({ ok: true }));
  app.get('/api/stats', (c) => c.json({ ok: true }));
  app.get('/api/tokens', (c) => c.json({ ok: true }));
  app.post('/api/tokens', (c) => c.json({ ok: true }));
  app.post('/api/chat', (c) => c.json({ ok: true }));
  app.post('/api/llm/openai/v1/chat/completions', (c) => c.json({ ok: true }));
  app.get('/api/some-future-route', (c) => c.json({ ok: true }));
  return app;
}

describe('Auth middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = buildApp();
    cleanupTokens();
  });

  afterEach(() => {
    cleanupTokens();
  });

  test('passes through when no Authorization header', async () => {
    const res = await app.request('/api/collections');
    expect(res.status).toBe(200);
  });

  test('returns 401 for invalid token', async () => {
    const res = await app.request('/api/collections', {
      headers: { Authorization: 'Bearer ltr_invalid_token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid token');
  });

  test('returns 401 for malformed Authorization header', async () => {
    const res = await app.request('/api/collections', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  test('returns 401 for empty Bearer value', async () => {
    const res = await app.request('/api/collections', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  test('passes through with valid token and wildcard scope', async () => {
    const token = createTestToken(['*']);
    const res = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('passes through with valid token and matching scope', async () => {
    const token = createTestToken(['collections:read']);
    const res = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('passes through with category wildcard scope', async () => {
    const token = createTestToken(['collections:*']);
    const res = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    // Write should also work with category wildcard
    const res2 = await app.request('/api/collections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'test' }),
    });
    expect(res2.status).toBe(200);
  });

  test('passes through with multiple specific scopes', async () => {
    const token = createTestToken(['collections:read', 'stats:read']);
    const res1 = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request('/api/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res2.status).toBe(200);
  });

  test('returns 403 for insufficient scope', async () => {
    const token = createTestToken(['stats:read']);
    const res = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Insufficient scope');
  });

  test('returns 403 for read scope on write operation', async () => {
    const token = createTestToken(['collections:read']);
    const res = await app.request('/api/collections', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'test' }),
    });
    expect(res.status).toBe(403);
  });

  test('returns 401 for expired token', async () => {
    const token = createTestToken(['*'], '2020-01-01T00:00:00Z');
    const res = await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Token has expired');
  });

  test('blocks PAT access to token management routes', async () => {
    const token = createTestToken(['*']);
    const res = await app.request('/api/tokens', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('local access');
  });

  test('allows unauthenticated access to token routes', async () => {
    const res = await app.request('/api/tokens');
    expect(res.status).toBe(200);
  });

  test('paid-LLM surfaces require the chat scope — a narrow token is denied (SECURITY-07)', async () => {
    const narrow = createTestToken(['vocab:read', 'collections:*']);
    for (const path of ['/api/chat', '/api/llm/openai/v1/chat/completions']) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${narrow}` },
      });
      expect(res.status).toBe(403);
    }

    const chatToken = createTestToken(['chat:write']);
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chatToken}` },
    });
    expect(res.status).toBe(200);
  });

  test('unmapped resources are default-deny for tokens, untouched for local access (SECURITY-07)', async () => {
    const god = createTestToken(['*']);
    const res = await app.request('/api/some-future-route', {
      headers: { Authorization: `Bearer ${god}` },
    });
    // Even '*' cannot reach a resource with no SCOPE_MAP entry — new routes
    // must be mapped before tokens can touch them.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not token-accessible');

    // Local (headerless) access is not scope-checked at all.
    const local = await app.request('/api/some-future-route');
    expect(local.status).toBe(200);
  });

  test('updates lastUsedAt on successful auth', async () => {
    const token = createTestToken(['*']);
    await app.request('/api/collections', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const row = db.prepare('SELECT lastUsedAt FROM api_tokens WHERE name = ?').get('test-token') as { lastUsedAt: string | null };
    expect(row.lastUsedAt).not.toBeNull();
  });
});
