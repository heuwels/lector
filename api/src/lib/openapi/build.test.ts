import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { operations } from './annotations';
import { buildDocument, isPublic, operationId } from './build';
import { collectEndpoints, endpointKey } from './endpoints';

const { document, drift, included } = buildDocument();
const full = buildDocument({ includeInternal: true });

type Operation = {
  operationId: string;
  summary: string;
  tags: string[];
  security: unknown[];
  responses: Record<string, unknown>;
  parameters?: Array<Record<string, unknown>>;
  'x-token-scope'?: string;
};

const paths = document.paths as Record<string, Record<string, Operation>>;

function everyOperation(doc: Record<string, unknown>): Operation[] {
  const table = doc.paths as Record<string, Record<string, Operation>>;
  return Object.values(table).flatMap((methods) => Object.values(methods));
}

/** Every `$ref` string anywhere in the document. */
function collectRefs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') found.push(child);
      else collectRefs(child, found);
    }
  }
  return found;
}

describe('operationId', () => {
  test('builds a stable camel-case name', () => {
    expect(operationId('GET', '/api/vocab')).toBe('getApiVocab');
    expect(operationId('GET', '/api/vocab/{id}')).toBe('getApiVocabById');
    expect(operationId('PUT', '/api/collections/{id}/lessons/reorder')).toBe(
      'putApiCollectionsByIdLessonsReorder',
    );
  });
});

describe('isPublic', () => {
  const endpoint = { method: 'GET', path: '/x', honoPath: '/x', pathParams: [], resource: 'x' };

  test('a token-reachable endpoint is public', () => {
    expect(isPublic({ ...endpoint, scope: 'vocab:read' }, undefined)).toBe(true);
  });

  test('an endpoint no token can reach is internal', () => {
    expect(isPublic({ ...endpoint, scope: null }, undefined)).toBe(false);
  });

  test('an annotation can override the derived visibility', () => {
    expect(
      isPublic(
        { ...endpoint, scope: null },
        { summary: 's', tag: 'Service', visibility: 'public' },
      ),
    ).toBe(true);
    expect(
      isPublic(
        { ...endpoint, scope: 'vocab:read' },
        { summary: 's', tag: 'Vocabulary', visibility: 'internal' },
      ),
    ).toBe(false);
  });
});

describe('the generated document', () => {
  test('declares OpenAPI 3.1 and both credentials', () => {
    expect(document.openapi).toBe('3.1.0');
    const components = document.components as Record<string, Record<string, unknown>>;
    expect(Object.keys(components.securitySchemes)).toEqual([
      'PersonalAccessToken',
      'SessionCookie',
    ]);
  });

  test('documents every route the app serves', () => {
    // The gate that keeps this honest. A new route fails here until somebody
    // adds an entry to annotations.ts.
    expect(drift.undocumented).toEqual([]);
    expect(drift.stale).toEqual([]);
  });

  test('holds every route in the full document', () => {
    const served = collectEndpoints().map(endpointKey);
    const documented = new Set(
      Object.entries(full.document.paths as Record<string, Record<string, unknown>>).flatMap(
        ([path, methods]) =>
          Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );
    for (const key of served) expect(documented.has(key)).toBe(true);
  });

  test('leaves out the endpoints a token cannot reach', () => {
    expect(paths['/api/admin/users']).toBeUndefined();
    expect(paths['/api/tokens']).toBeUndefined();
    expect(paths['/api/billing/status']).toBeUndefined();
    // The full document keeps them.
    const fullPaths = full.document.paths as Record<string, unknown>;
    expect(fullPaths['/api/admin/users']).toBeDefined();
    expect(fullPaths['/api/tokens']).toBeDefined();
  });

  test('states the token scope of each authenticated operation', () => {
    for (const endpoint of included) {
      const operation = paths[endpoint.path][endpoint.method.toLowerCase()];
      if (endpoint.scope === null) continue;
      expect(operation['x-token-scope']).toBe(endpoint.scope);
    }
  });

  test('carries the read scope on a GET and the write scope on a POST', () => {
    expect(paths['/api/vocab'].get['x-token-scope']).toBe('vocab:read');
    expect(paths['/api/vocab'].post['x-token-scope']).toBe('vocab:write');
    // known-words rides the vocab scope, exactly as lib/auth.ts checks it.
    expect(paths['/api/known-words'].post['x-token-scope']).toBe('vocab:write');
  });

  test('declares every path parameter', () => {
    for (const endpoint of included) {
      const operation = paths[endpoint.path][endpoint.method.toLowerCase()];
      const declared = (operation.parameters ?? [])
        .filter((param) => param.in === 'path')
        .map((param) => param.name);
      expect(declared.sort()).toEqual([...endpoint.pathParams].sort());
    }
  });

  test('adds the shared error responses to an authenticated operation', () => {
    const operation = paths['/api/vocab'].get;
    for (const status of ['401', '403', '429', '500']) {
      expect(operation.responses[status]).toBeDefined();
    }
  });

  test('leaves the health check open', () => {
    const health = paths['/health'].get;
    expect(health.security).toEqual([]);
    expect(health.responses['401']).toBeUndefined();
  });

  test('gives a body-carrying operation a 400, and an id-carrying one a 404', () => {
    expect(paths['/api/collections'].post.responses['400']).toBeDefined();
    expect(paths['/api/collections/{id}'].get.responses['404']).toBeDefined();
    expect(paths['/api/collections'].get.responses['404']).toBeUndefined();
  });

  test('uses a unique operationId', () => {
    const ids = everyOperation(full.document).map((operation) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('resolves every $ref', () => {
    const components = full.document.components as Record<string, Record<string, unknown>>;
    for (const ref of collectRefs(full.document)) {
      const [, , section, name] = ref.split('/');
      expect(ref.startsWith('#/components/')).toBe(true);
      expect(components[section]?.[name]).toBeDefined();
    }
  });

  test('names a declared tag on every operation', () => {
    const declared = new Set(
      (full.document.tags as Array<{ name: string }>).map((tag) => tag.name),
    );
    for (const operation of everyOperation(full.document)) {
      for (const tag of operation.tags) expect(declared.has(tag)).toBe(true);
    }
  });

  test('gives every operation a summary', () => {
    for (const operation of everyOperation(full.document)) {
      expect(operation.summary.length).toBeGreaterThan(0);
    }
  });

  test('gives every public operation a success response schema', () => {
    // Internal operations are summary-only on purpose, so check the published
    // document, not the full one.
    expect(drift.schemaless).toEqual([]);
  });

  test('keeps the annotation keys in the exact route key form', () => {
    for (const key of Object.keys(operations)) {
      expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE|HEAD) \/[^\s]*$/);
      expect(key).not.toContain(':');
    }
  });
});

describe('api/openapi.json', () => {
  test('matches a fresh build', () => {
    // The same comparison `gen-openapi.ts --check` makes, so CI catches a
    // stale committed document without a separate workflow step.
    const path = join(import.meta.dir, '..', '..', '..', 'openapi.json');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(document, null, 2)}\n`);
  });
});
