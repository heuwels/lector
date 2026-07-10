import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import {
  BYOK_MODELS,
  BYOK_PROVIDER,
  DEFAULT_BYOK_MODEL,
  deleteByokCredential,
  getByokCredential,
  isByokAvailable,
  saveByokCredential,
  validateOpenRouterKey,
} from '../lib/byok';

const app = new Hono();
const allowedModels = new Set<string>(BYOK_MODELS.map((model) => model.id));

app.get('/', (c) => {
  const userId = getCurrentUserId(c);
  let credential = null;
  try {
    credential = getByokCredential(userId);
  } catch {
    // A missing/rotated server key must not leak crypto details or claim BYOK
    // is active. The operator-facing availability flag is sufficient.
  }
  return c.json({
    available: isByokAvailable(),
    enabled: Boolean(credential),
    provider: BYOK_PROVIDER,
    model: credential?.model ?? DEFAULT_BYOK_MODEL,
    models: BYOK_MODELS,
  });
});

app.put('/', async (c) => {
  const userId = getCurrentUserId(c);
  if (!isByokAvailable()) {
    return c.json({ error: 'BYOK is not available on this deployment' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as { apiKey?: unknown; model?: unknown };
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' ? body.model : DEFAULT_BYOK_MODEL;
  if (!apiKey) return c.json({ error: 'OpenRouter API key is required' }, 400);
  if (!allowedModels.has(model)) return c.json({ error: 'Unsupported model' }, 400);

  // Validate before persisting. The generic error intentionally excludes the
  // upstream response body, which can contain account/provider details.
  if (!(await validateOpenRouterKey(apiKey)))
    return c.json({ error: 'OpenRouter rejected the key or could not be reached' }, 400);

  saveByokCredential(userId, apiKey, model);
  return c.json({ enabled: true, provider: BYOK_PROVIDER, model });
});

app.delete('/', (c) => {
  deleteByokCredential(getCurrentUserId(c));
  return c.json({ enabled: false });
});

export default app;
