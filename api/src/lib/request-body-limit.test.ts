import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import {
  DEFAULT_API_REQUEST_BODY_LIMIT_BYTES,
  makeDefaultRequestBodyLimit,
  shouldApplyDefaultRequestBodyLimit,
} from './request-body-limit';

function makeApp(maxSize: number): Hono {
  const app = new Hono();
  app.use('/api/*', makeDefaultRequestBodyLimit(maxSize));
  return app;
}

describe('default API request-body limit', () => {
  test('defaults to 8 MiB and returns 413 before an ordinary handler parses the body', async () => {
    expect(DEFAULT_API_REQUEST_BODY_LIMIT_BYTES).toBe(8 * 1024 * 1024);
    const app = makeApp(16);
    let handlerCalls = 0;
    app.post('/api/ordinary', async (c) => {
      handlerCalls++;
      await c.req.json();
      return c.json({ ok: true });
    });

    const response = await app.request('/api/ordinary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(32) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request body is too large' });
    expect(handlerCalls).toBe(0);
  });

  test('reconstructs and passes a normal body through to the route parser', async () => {
    const app = makeApp(128);
    app.post('/api/ordinary', async (c) => c.json({ received: await c.req.json() }));

    const response = await app.request('/api/ordinary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phrase: 'lekker lees' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: { phrase: 'lekker lees' } });
  });

  test('exempts only the purpose-capped paths and preserves Paddle raw bytes', async () => {
    const app = makeApp(8);
    for (const path of ['/api/data', '/api/import/epub', '/api/billing/webhook']) {
      app.post(path, async (c) => c.text(await c.req.text()));
    }
    app.post('/api/data-export', async (c) => c.text(await c.req.text()));

    const rawBody = '  {"event_type":"subscription.updated"}\n';
    for (const path of ['/api/data', '/api/import/epub', '/api/billing/webhook']) {
      const response = await app.request(path, { method: 'POST', body: rawBody });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(rawBody);
    }

    // Prefix lookalikes are not exempt.
    expect(
      (
        await app.request('/api/data-export', {
          method: 'POST',
          body: rawBody,
        })
      ).status,
    ).toBe(413);
  });

  test('skips GET and HEAD regardless of path', () => {
    expect(shouldApplyDefaultRequestBodyLimit('GET', '/api/ordinary')).toBe(false);
    expect(shouldApplyDefaultRequestBodyLimit('head', '/api/ordinary')).toBe(false);
    expect(shouldApplyDefaultRequestBodyLimit('POST', '/api/ordinary')).toBe(true);
  });
});
