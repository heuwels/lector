import { createMiddleware } from 'hono/factory';
import { db, ApiTokenRow } from '../db';
import { config } from './config';
import { hashToken } from './crypto';
import { LOCAL_USER_ID } from './user';

const SCOPE_MAP: Record<string, { read: string; write: string }> = {
  collections:     { read: 'collections:read', write: 'collections:write' },
  groups:          { read: 'collections:read', write: 'collections:write' },
  lessons:         { read: 'collections:read', write: 'collections:write' },
  vocab:           { read: 'vocab:read',       write: 'vocab:write' },
  'known-words':   { read: 'vocab:read',       write: 'vocab:write' },
  cloze:           { read: 'vocab:read',       write: 'vocab:write' },
  stats:           { read: 'stats:read',       write: 'stats:write' },
  settings:        { read: 'settings:read',    write: 'settings:write' },
  translate:       { read: 'vocab:read',       write: 'vocab:read' },
  explain:         { read: 'vocab:read',       write: 'vocab:read' },
  tts:             { read: 'vocab:read',       write: 'vocab:read' },
  tatoeba:         { read: 'vocab:read',       write: 'vocab:read' },
  dictionary:      { read: 'vocab:read',       write: 'vocab:read' },
  anki:            { read: 'settings:read',    write: 'settings:write' },
  'study-ping':    { read: 'stats:read',       write: 'stats:write' },
  data:            { read: 'data:export',      write: 'data:import' },
  'extract-url':   { read: 'collections:write', write: 'collections:write' },
  import:          { read: 'collections:write', write: 'collections:write' },
  'journal-correct': { read: 'vocab:read',     write: 'vocab:read' },
  journal:         { read: 'collections:read', write: 'collections:write' },
  'llm-status':    { read: 'settings:read',    write: 'settings:write' },
  'translate-compare': { read: 'vocab:read',  write: 'vocab:write' },
  // Paid-LLM surfaces get their own category: a narrowly-scoped token must
  // not be able to spend LLM credits (SECURITY-07).
  chat:            { read: 'chat:read',        write: 'chat:write' },
  llm:             { read: 'chat:read',        write: 'chat:write' },
};

function getResourceFromPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  return segments[1] || null; // segments[0] = 'api'
}

function getRequiredScope(resource: string, method: string): string | null {
  const mapping = SCOPE_MAP[resource];
  // Unmapped resources are the caller's problem, not a free pass — the
  // middleware treats null as deny (default-deny, SECURITY-07). A new route
  // must be added to SCOPE_MAP before tokens can reach it.
  if (!mapping) return null;

  const isRead = method === 'GET' || method === 'HEAD';
  return isRead ? mapping.read : mapping.write;
}

function tokenHasScope(tokenScopes: string[], requiredScope: string): boolean {
  if (tokenScopes.includes('*')) return true;
  if (tokenScopes.includes(requiredScope)) return true;

  // Check wildcard: 'collections:*' matches 'collections:read'
  const [category] = requiredScope.split(':');
  if (tokenScopes.includes(`${category}:*`)) return true;

  return false;
}

function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson);
    return Array.isArray(parsed) ? parsed : ['*'];
  } catch {
    return ['*'];
  }
}

/**
 * PAT middleware factory (mirrors makeSessionMiddleware in lib/session.ts).
 * `authRequired` is cloud proper: there a PAT is a real credential that must
 * resolve a tenant, so tokens minted before accounts existed (userId 'local')
 * are refused — accepting one would grant session-less access to the shared
 * pre-accounts pseudo-tenant. Selfhost/external-gate keeps today's behaviour:
 * every token is the implicit local user's.
 */
export function makePatMiddleware(authRequired: boolean) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    // No auth header = local access (selfhost) or an already-authenticated
    // session (cloud — the session middleware ran first), pass through
    if (!authHeader) return next();

    // Must be Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Invalid authorization format. Use: Bearer <token>' }, 401);
    }

    const token = authHeader.slice(7);
    if (!token) {
      return c.json({ error: 'Missing token' }, 401);
    }

    // Block PAT access to token management routes — tokens are managed in the
    // browser Settings UI (local access in selfhost, a session in cloud), never
    // by another token: a leaked PAT must not be able to mint itself successors.
    const resource = getResourceFromPath(c.req.path);
    if (resource === 'tokens') {
      return c.json({ error: 'Token management requires the Settings UI, not token auth' }, 403);
    }

    // Hash the presented token and look it up via indexed column
    const hex = hashToken(token);
    const matchedToken = db.prepare(
      'SELECT * FROM api_tokens WHERE tokenHash = ?'
    ).get(hex) as ApiTokenRow | undefined;

    if (!matchedToken) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Check expiry
    if (matchedToken.expiresAt && new Date(matchedToken.expiresAt) < new Date()) {
      return c.json({ error: 'Token has expired' }, 401);
    }

    // Cloud proper: the PAT is the credential, so it must carry a real tenant
    // (#218). Pre-accounts tokens resolve to the 'local' pseudo-tenant — fail
    // closed rather than expose pre-flip shared data to an old key.
    if (authRequired && matchedToken.userId === LOCAL_USER_ID) {
      return c.json({ error: 'Token predates accounts — sign in and mint a new one' }, 401);
    }

    // Check scope — default-deny: a resource with no SCOPE_MAP entry is not
    // reachable with a token at all (SECURITY-07). Local/unauthenticated access
    // is unaffected (it never reaches this branch).
    if (resource) {
      const requiredScope = getRequiredScope(resource, c.req.method);
      if (requiredScope === null) {
        return c.json(
          { error: `Insufficient scope. Resource "${resource}" is not token-accessible.` },
          403,
        );
      }
      const scopes = parseScopes(matchedToken.scopes);
      if (!tokenHasScope(scopes, requiredScope)) {
        return c.json({ error: `Insufficient scope. Required: ${requiredScope}` }, 403);
      }
    }

    // Resolve the tenant the token belongs to. In selfhost this is always
    // 'local' (getCurrentUserId ignores it); in cloud it feeds the same
    // identity seam a session does, so routes scope rows identically (#218).
    c.set('userId', matchedToken.userId);

    // Store token info in context for routes that need it
    c.set('tokenId', matchedToken.id);
    c.set('tokenName', matchedToken.name);
    c.set('tokenScopes', parseScopes(matchedToken.scopes));

    // Update lastUsedAt
    db.prepare('UPDATE api_tokens SET lastUsedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), matchedToken.id);

    return next();
  });
}

/** The prod middleware, bound to the resolved deployment config. */
export const authMiddleware = makePatMiddleware(config.authRequired);
