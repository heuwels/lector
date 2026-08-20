import { SCOPE_MAP } from '../auth';
import { routeMounts, type RouteMount } from '../../routes/registry';

/** One HTTP operation the API serves. */
export interface Endpoint {
  /** Upper-case HTTP method, e.g. `GET`. */
  method: string;
  /** OpenAPI path, e.g. `/api/vocab/{id}`. */
  path: string;
  /** Hono path, e.g. `/api/vocab/:id`. Kept for error messages. */
  honoPath: string;
  /** Path parameter names, in order. */
  pathParams: string[];
  /** Resource segment the PAT scope check reads, e.g. `vocab`. */
  resource: string | null;
  /** The scope a personal access token needs, or null when tokens cannot reach it. */
  scope: string | null;
}

/** `GET /api/vocab/{id}` — the key both the annotations file and drift checks use. */
export function endpointKey(endpoint: Pick<Endpoint, 'method' | 'path'>): string {
  return `${endpoint.method} ${endpoint.path}`;
}

/**
 * Hono path syntax -> OpenAPI path syntax.
 *
 * Handles the three forms Hono accepts: a plain `:name`, a regex-constrained
 * `:name{[0-9]+}`, and an optional `:name?`. OpenAPI has no optional path
 * parameter, so `:name?` becomes a required `{name}` — document the
 * no-parameter form as its own path if a route needs both.
 */
export function toOpenApiPath(honoPath: string): string {
  return honoPath
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const name = segment
        .slice(1)
        .replace(/\{.*\}$/, '')
        .replace(/\?$/, '');
      return `{${name}}`;
    })
    .join('/');
}

/** Parameter names in an OpenAPI path, in order. */
export function pathParamNames(openApiPath: string): string[] {
  return [...openApiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

/**
 * The resource segment `lib/auth.ts` keys its scope check on: segment 1 of
 * `/api/<resource>/...`. Kept identical to `getResourceFromPath` there, so the
 * documented scope is the scope a request is really checked against.
 */
export function resourceOf(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  return segments[1] || null;
}

/** The scope a PAT needs, or null when the resource is not token-accessible. */
export function scopeFor(resource: string | null, method: string): string | null {
  if (!resource) return null;
  const mapping = SCOPE_MAP[resource];
  if (!mapping) return null;
  return method === 'GET' || method === 'HEAD' ? mapping.read : mapping.write;
}

/**
 * Every operation the mounted route modules serve, deduplicated and sorted.
 *
 * Read from the live Hono instances, not from source text: a route's real
 * method and path are whatever it registered at import time, including routes
 * built by a factory (`makeDictionaryRoutes()`) or wrapped in per-route
 * middleware. Two entries are dropped:
 *
 * - `ALL` registrations, which are `app.use()` middleware, not operations.
 * - Duplicates. Hono records one entry per handler in a chain, so a route with
 *   a `bodyLimit` in front of it appears twice.
 */
export function collectEndpoints(mounts: readonly RouteMount[] = routeMounts): Endpoint[] {
  const byKey = new Map<string, Endpoint>();

  for (const { prefix, app } of mounts) {
    for (const route of app.routes) {
      const method = route.method.toUpperCase();
      if (method === 'ALL') continue;

      const honoPath = prefix + (route.path === '/' ? '' : route.path);
      if (honoPath.endsWith('/*')) continue;

      const path = toOpenApiPath(honoPath);
      const resource = resourceOf(path);
      const endpoint: Endpoint = {
        method,
        path,
        honoPath,
        pathParams: pathParamNames(path),
        resource,
        scope: scopeFor(resource, method),
      };
      byKey.set(endpointKey(endpoint), endpoint);
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}
