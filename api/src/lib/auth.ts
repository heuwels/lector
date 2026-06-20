import { createMiddleware } from 'hono/factory';
import { db, ApiTokenRow } from '../db';
import { hashToken } from './crypto';

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
  anki:            { read: 'settings:read',    write: 'settings:write' },
  'study-ping':    { read: 'stats:read',       write: 'stats:write' },
  data:            { read: 'data:export',      write: 'data:import' },
  'extract-url':   { read: 'collections:write', write: 'collections:write' },
  import:          { read: 'collections:write', write: 'collections:write' },
  'journal-correct': { read: 'vocab:read',     write: 'vocab:read' },
  'llm-status':    { read: 'settings:read',    write: 'settings:write' },
  'translate-compare': { read: 'vocab:read',  write: 'vocab:write' },
};

function getResourceFromPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  return segments[1] || null; // segments[0] = 'api'
}

function getRequiredScope(resource: string, method: string): string | null {
  const mapping = SCOPE_MAP[resource];
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

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  // No auth header = local access, pass through
  if (!authHeader) return next();

  // Must be Bearer token
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Invalid authorization format. Use: Bearer <token>' }, 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json({ error: 'Missing token' }, 401);
  }

  // Block PAT access to token management routes — tokens can only be
  // managed via local/unauthenticated access (browser Settings UI)
  const resource = getResourceFromPath(c.req.path);
  if (resource === 'tokens') {
    return c.json({ error: 'Token management is only available via local access' }, 403);
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

  // Check scope
  if (resource) {
    const requiredScope = getRequiredScope(resource, c.req.method);
    if (requiredScope) {
      const scopes = parseScopes(matchedToken.scopes);
      if (!tokenHasScope(scopes, requiredScope)) {
        return c.json({ error: `Insufficient scope. Required: ${requiredScope}` }, 403);
      }
    }
  }

  // Store token info in context for routes that need it
  c.set('tokenId', matchedToken.id);
  c.set('tokenName', matchedToken.name);
  c.set('tokenScopes', parseScopes(matchedToken.scopes));

  // Update lastUsedAt
  db.prepare('UPDATE api_tokens SET lastUsedAt = ? WHERE id = ?')
    .run(new Date().toISOString(), matchedToken.id);

  return next();
});
