import { Hono } from 'hono';
import { getProvider, resetProvider } from '../lib/llm';

const app = new Hono();

// GET /api/llm-status
app.get('/', async (c) => {
  const provider = getProvider();
  const health = await provider.healthCheck();

  return c.json({
    provider: provider.name,
    model: process.env.OLLAMA_MODEL || process.env.ANTHROPIC_MODEL || 'default',
    ...health,
  });
});

// POST /api/llm-status/test — test with a trivial completion
app.post('/test', async (c) => {
  try {
    const provider = getProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Respond with exactly: {"ok":true}' }],
      maxTokens: 32,
    });

    return c.json({ ok: true, response: result });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Test failed' },
      500
    );
  }
});

// POST /api/llm-status/reset — clear cached provider (after settings change)
app.post('/reset', async (c) => {
  resetProvider();
  return c.json({ ok: true });
});

export default app;
