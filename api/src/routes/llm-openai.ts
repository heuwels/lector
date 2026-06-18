import { Hono } from 'hono';
import { OpenAICompatibleProvider } from '../lib/llm/openai-compatible';
import { db } from '../db';

const app = new Hono();

interface ModelsBody {
  endpoint?: string;
  apiKey?: string;
}

/**
 * Read the saved API key from settings. The browser never sends the saved key
 * over the wire (the settings GET masks it as `true`), so the server resolves
 * it itself when the request body doesn't carry one.
 */
function resolveApiKey(bodyKey: string | undefined): string | undefined {
  const trimmed = bodyKey?.trim();
  if (trimmed) return trimmed;
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('openaiApiKey') as { value: string } | undefined;
  if (!row) return undefined;
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === 'string' && parsed ? parsed : undefined;
  } catch {
    return row.value || undefined;
  }
}

// POST /api/llm/openai/models — list models the OpenAI-compatible endpoint reports.
// Server-side proxy so the browser doesn't hit the endpoint cross-origin and so the
// API key (if any) stays out of the browser network tab beyond the lector form submit.
app.post('/models', async (c) => {
  let body: ModelsBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const baseUrl = (body.endpoint || '').trim();
  if (!baseUrl) {
    return c.json({ error: 'endpoint is required' }, 400);
  }

  const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey: resolveApiKey(body.apiKey),
  });

  try {
    const models = await provider.listModels();
    return c.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 502);
  }
});

export default app;
