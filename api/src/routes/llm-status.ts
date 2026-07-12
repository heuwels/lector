import { Hono } from 'hono';
import { getProvider, MANAGED_TRANSLATION_MODEL, resetProvider } from '../lib/llm';
import { getCurrentUserId } from '../lib/user';
import { entitlements, planLimitResponse } from '../lib/entitlements';

const app = new Hono();

// GET /api/llm-status
app.get('/', async (c) => {
  const userId = getCurrentUserId(c);
  const resolved = entitlements.resolveEntitlements(userId);
  if (resolved.plan === 'free' && !resolved.byok) {
    // Cloud Settings does not render this legacy self-host provider probe.
    // Avoid turning it into an unmetered OpenRouter health endpoint for every
    // public Free account; boot validation already proved this exact managed
    // path is configured.
    return c.json({ provider: 'openai', model: MANAGED_TRANSLATION_MODEL, ok: true });
  }

  const provider = getProvider(userId, { byok: resolved.byok });
  const health = await provider.healthCheck();

  return c.json({
    provider: provider.name,
    model: provider.model || 'default',
    ...health,
  });
});

// POST /api/llm-status/test — test with a trivial completion
app.post('/test', async (c) => {
  const userId = getCurrentUserId(c);
  const verdict = entitlements.reserve(userId, 'llmRequestsPerMonth');
  if (!verdict.allowed) return planLimitResponse(c, verdict);
  try {
    const provider = getProvider(userId, { byok: verdict.reservation.byok });
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Respond with exactly: {"ok":true}' }],
      maxTokens: 32,
    });

    return c.json({ ok: true, response: result });
  } catch (error) {
    entitlements.refund(verdict.reservation);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Test failed' },
      500,
    );
  }
});

// POST /api/llm-status/reset — clear cached provider (after settings change)
app.post('/reset', async (c) => {
  const resolved = entitlements.resolveEntitlements(getCurrentUserId(c));
  // Free's managed provider is deployment-pinned, while its BYOK providers
  // are deliberately never process-cached. Neither needs permission to churn
  // the process-global paid/self-host provider cache.
  if (resolved.plan === 'free') return c.json({ ok: true });
  resetProvider();
  return c.json({ ok: true });
});

export default app;
