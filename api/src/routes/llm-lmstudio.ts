import { Hono } from 'hono';
import { LMStudioProvider } from '../lib/llm/lmstudio';

const app = new Hono();

interface BaseBody {
  endpoint?: string;
  apiKey?: string;
}

// POST /api/llm/lmstudio/models — list models known to LM Studio at the given endpoint.
// Server-side proxy so the browser doesn't hit LM Studio cross-origin and so the API key
// (if any) stays out of the browser network tab beyond the lector form submit.
app.post('/models', async (c) => {
  let body: BaseBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const baseUrl = (body.endpoint || '').trim();
  if (!baseUrl) {
    return c.json({ error: 'endpoint is required' }, 400);
  }

  const provider = new LMStudioProvider({
    baseUrl,
    apiKey: body.apiKey?.trim() || undefined,
  });

  try {
    const models = await provider.listModels();
    return c.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 502);
  }
});

interface LoadBody extends BaseBody {
  model?: string;
}

// POST /api/llm/lmstudio/load — explicitly load a model on LM Studio. Synchronous
// per LM Studio's API: this resolves once the model finishes loading (or errors).
app.post('/load', async (c) => {
  let body: LoadBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const baseUrl = (body.endpoint || '').trim();
  const model = (body.model || '').trim();
  if (!baseUrl) return c.json({ error: 'endpoint is required' }, 400);
  if (!model) return c.json({ error: 'model is required' }, 400);

  const provider = new LMStudioProvider({
    baseUrl,
    apiKey: body.apiKey?.trim() || undefined,
  });

  const result = await provider.loadModel(model);
  if (!result.ok) {
    return c.json(
      { ok: false, error: result.error || 'load failed' },
      502,
    );
  }
  return c.json(result);
});

export default app;
