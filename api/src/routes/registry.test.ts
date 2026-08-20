import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { routeMounts } from './registry';

const indexSource = readFileSync(join(import.meta.dir, '..', 'index.ts'), 'utf8');

/** Source with `//` comments removed, so a commented example cannot match. */
const code = indexSource.replace(/^\s*\/\/.*$/gm, '');

/**
 * Every path `index.ts` registers a handler for directly, rather than through
 * the registry. `app.use()` is middleware, not an operation, so it stays out.
 */
function directlyRegisteredPaths(): string[] {
  const paths = new Set<string>();

  // app.get('/health', ...) and friends.
  for (const match of code.matchAll(
    /\bapp\.(get|post|put|patch|delete|options|head|all)\(\s*'([^']+)'/g,
  )) {
    paths.add(match[2]);
  }
  // app.on(['POST', 'GET'], '/api/auth/*', ...)
  for (const match of code.matchAll(/\bapp\.on\(\s*\[[^\]]*\]\s*,\s*'([^']+)'/g)) {
    paths.add(match[1]);
  }

  return [...paths].sort();
}

describe('the route registry', () => {
  test('holds every mounted prefix once', () => {
    const prefixes = routeMounts.map((mount) => mount.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) expect(prefix.startsWith('/api/')).toBe(true);
  });

  test('is the only place index.ts mounts route modules', () => {
    // One `app.route()` call, inside the loop over the registry. A second call
    // would serve routes the OpenAPI drift gate cannot see.
    expect(code.match(/\bapp\.route\(/g)?.length).toBe(1);
    expect(code).toContain('for (const { prefix, app: routes } of routeMounts)');
  });

  test('leaves only the health check and Better Auth registered directly', () => {
    // The drift gate reads the registry plus `extraEndpoints`. Anything else
    // that index.ts serves would be undocumented and unnoticed, so pin the
    // exceptions: /health is in `extraEndpoints`, and Better Auth owns its own
    // contract. Adding a route here must fail until it is handled.
    expect(directlyRegisteredPaths()).toEqual(['/api/auth/*', '/health']);
  });
});
