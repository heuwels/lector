import { Hono } from 'hono';
import { getCurrentUserId } from '../lib/user';
import {
  BYOK_CATALOG,
  BYOK_PROVIDERS,
  DEFAULT_BYOK_PROVIDER,
  type ByokProvider,
  deleteByokCredential,
  getByokCredential,
  isByokAvailable,
  saveByokCredential,
  validateAnthropicKey,
  validateOpenRouterKey,
} from '../lib/byok';

const app = new Hono();

function isProvider(value: unknown): value is ByokProvider {
  return typeof value === 'string' && BYOK_PROVIDERS.includes(value as ByokProvider);
}

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
    provider: credential?.provider ?? DEFAULT_BYOK_PROVIDER,
    model: credential?.model ?? BYOK_CATALOG[DEFAULT_BYOK_PROVIDER].defaultModel,
    providers: BYOK_CATALOG,
  });
});

app.put('/', async (c) => {
  const userId = getCurrentUserId(c);
  if (!isByokAvailable()) {
    return c.json({ error: 'BYOK is not available on this deployment' }, 503);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    provider?: unknown;
    apiKey?: unknown;
    model?: unknown;
  };
  const provider = body.provider ?? DEFAULT_BYOK_PROVIDER;
  if (!isProvider(provider)) return c.json({ error: 'Unsupported provider' }, 400);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const catalog = BYOK_CATALOG[provider];
  const model = typeof body.model === 'string' ? body.model : catalog.defaultModel;
  if (apiKey.length > 512) return c.json({ error: 'API key is too long' }, 400);
  if (!catalog.models.some((item) => item.id === model)) {
    return c.json({ error: 'Unsupported model' }, 400);
  }

  // Validate before persisting. The generic error intentionally excludes the
  // upstream response body, which can contain account/provider details.
  const existing = getByokCredential(userId);
  if (!apiKey && existing?.provider !== provider) {
    return c.json({ error: `${catalog.label} API key is required` }, 400);
  }
  const effectiveKey = apiKey || existing!.apiKey;
  if (apiKey) {
    const valid =
      provider === 'anthropic'
        ? await validateAnthropicKey(apiKey)
        : await validateOpenRouterKey(apiKey);
    if (!valid)
      return c.json({ error: `${catalog.label} rejected the key or could not be reached` }, 400);
  }

  saveByokCredential(userId, provider, effectiveKey, model);
  return c.json({ enabled: true, provider, model });
});

app.delete('/', (c) => {
  deleteByokCredential(getCurrentUserId(c));
  return c.json({ enabled: false });
});

export default app;
