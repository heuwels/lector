import { Hono } from 'hono';

const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL || 'http://localhost:8765';

async function ankiRequest(action: string, params?: Record<string, unknown>) {
  const res = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  if (!res.ok) throw new Error(`AnkiConnect HTTP error: ${res.status}`);
  return res.json();
}

function triggerSync() {
  ankiRequest('sync').catch(err => console.error('[Anki] sync failed:', err));
}

const app = new Hono();

// GET /api/anki
app.get('/', async (c) => {
  try {
    const [versionRes, decksRes] = await Promise.all([
      ankiRequest('version'),
      ankiRequest('deckNames'),
    ]);
    return c.json({
      connected: true,
      version: versionRes.result,
      decks: decksRes.result ?? [],
    });
  } catch (err) {
    return c.json({
      connected: false,
      error: err instanceof Error ? err.message : 'Could not connect to Anki',
    });
  }
});

// POST /api/anki
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { action, params } = body as { action: string; params?: Record<string, unknown> };

    const result = await ankiRequest(action, params);

    if (action === 'addNote' && result.error === null) {
      triggerSync();
    }

    return c.json(result);
  } catch (err) {
    return c.json(
      { result: null, error: err instanceof Error ? err.message : 'AnkiConnect request failed' },
      500
    );
  }
});

export default app;
