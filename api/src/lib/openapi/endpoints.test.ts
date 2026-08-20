import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

import {
  collectEndpoints,
  endpointKey,
  pathParamNames,
  resourceOf,
  scopeFor,
  toOpenApiPath,
} from './endpoints';

describe('toOpenApiPath', () => {
  test('rewrites a plain parameter', () => {
    expect(toOpenApiPath('/api/vocab/:id')).toBe('/api/vocab/{id}');
  });

  test('rewrites several parameters', () => {
    expect(toOpenApiPath('/api/collections/:id/lessons/:lessonId')).toBe(
      '/api/collections/{id}/lessons/{lessonId}',
    );
  });

  test('drops a regex constraint', () => {
    expect(toOpenApiPath('/api/vocab/:id{[0-9]+}')).toBe('/api/vocab/{id}');
  });

  test('drops the optional marker', () => {
    expect(toOpenApiPath('/api/vocab/:id?')).toBe('/api/vocab/{id}');
  });

  test('leaves a static path alone', () => {
    expect(toOpenApiPath('/api/stats/today')).toBe('/api/stats/today');
  });
});

describe('pathParamNames', () => {
  test('reads the names in order', () => {
    expect(pathParamNames('/api/collections/{id}/lessons/{lessonId}')).toEqual(['id', 'lessonId']);
  });

  test('returns nothing for a static path', () => {
    expect(pathParamNames('/api/stats')).toEqual([]);
  });
});

describe('resourceOf', () => {
  test('reads the segment after /api', () => {
    expect(resourceOf('/api/known-words')).toBe('known-words');
    expect(resourceOf('/api/vocab/{id}')).toBe('vocab');
  });

  test('returns null when there is no resource segment', () => {
    expect(resourceOf('/api')).toBeNull();
    expect(resourceOf('/health')).toBeNull();
  });
});

describe('scopeFor', () => {
  test('reads a scope for a mapped resource', () => {
    expect(scopeFor('vocab', 'GET')).toBe('vocab:read');
    expect(scopeFor('vocab', 'POST')).toBe('vocab:write');
    expect(scopeFor('vocab', 'HEAD')).toBe('vocab:read');
  });

  test('maps a related resource onto its owning scope', () => {
    expect(scopeFor('known-words', 'POST')).toBe('vocab:write');
    expect(scopeFor('lessons', 'GET')).toBe('collections:read');
  });

  test('returns null for a resource a token cannot reach', () => {
    // Default-deny in lib/auth.ts: no SCOPE_MAP entry means no token access.
    expect(scopeFor('admin', 'GET')).toBeNull();
    expect(scopeFor('billing', 'POST')).toBeNull();
    expect(scopeFor(null, 'GET')).toBeNull();
  });
});

describe('collectEndpoints', () => {
  test('joins the mount prefix to the route path', () => {
    const app = new Hono();
    app.get('/', (c) => c.json({}));
    app.get('/:id', (c) => c.json({}));

    const endpoints = collectEndpoints([{ prefix: '/api/vocab', app }]);

    expect(endpoints.map(endpointKey)).toEqual(['GET /api/vocab', 'GET /api/vocab/{id}']);
  });

  test('drops middleware and deduplicates a handler chain', () => {
    const app = new Hono();
    // app.use registers an ALL /* entry, and a route with per-route middleware
    // registers one entry per handler in the chain.
    app.use('*', async (_c, next) => next());
    app.post(
      '/cache',
      async (_c, next) => next(),
      (c) => c.json({}),
    );

    const endpoints = collectEndpoints([{ prefix: '/api/dictionary', app }]);

    expect(endpoints.map(endpointKey)).toEqual(['POST /api/dictionary/cache']);
  });

  test('carries the scope and the path parameters', () => {
    const app = new Hono();
    app.delete('/:id', (c) => c.json({}));

    const [endpoint] = collectEndpoints([{ prefix: '/api/vocab', app }]);

    expect(endpoint.resource).toBe('vocab');
    expect(endpoint.scope).toBe('vocab:write');
    expect(endpoint.pathParams).toEqual(['id']);
    expect(endpoint.honoPath).toBe('/api/vocab/:id');
  });

  test('reads the real route table of the app', () => {
    const keys = collectEndpoints().map(endpointKey);

    expect(keys).toContain('GET /api/collections');
    expect(keys).toContain('POST /api/known-words');
    expect(keys).toContain('GET /api/cloze/{id}');
    // Middleware must never reach the document.
    expect(keys.some((key) => key.includes('*'))).toBe(false);
    // One entry per method and path, however many handlers the chain holds.
    expect(new Set(keys).size).toBe(keys.length);
  });
});
