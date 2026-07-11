import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';

export const DEFAULT_API_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

// These routes own a different ingress contract and apply their limit directly
// at the route before parsing. Keep this exact: nearby or future routes should
// inherit the conservative default until they deliberately add their own cap.
const PURPOSE_SPECIFIC_LIMIT_PATHS = new Set([
  '/api/data',
  '/api/import/epub',
  '/api/billing/webhook',
]);

function withoutOneTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function shouldApplyDefaultRequestBodyLimit(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') return false;
  return !PURPOSE_SPECIFIC_LIMIT_PATHS.has(withoutOneTrailingSlash(path));
}

/**
 * Conservative API-wide ingress boundary. Hono's bodyLimit rejects from
 * Content-Length when available; otherwise it streams only up to the ceiling
 * and reconstructs the request byte-for-byte for downstream JSON/form parsers.
 */
export function makeDefaultRequestBodyLimit(
  maxSize: number = DEFAULT_API_REQUEST_BODY_LIMIT_BYTES,
): MiddlewareHandler {
  const enforce = bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: 'Request body is too large' }, 413),
  });

  return async (c, next) => {
    if (!shouldApplyDefaultRequestBodyLimit(c.req.method, c.req.path)) return next();
    return enforce(c, next);
  };
}

export const defaultRequestBodyLimit = makeDefaultRequestBodyLimit();
