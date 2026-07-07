import { Hono } from 'hono';
import { LOCAL_USER_ID } from '../lib/user';
import { db } from '../db';
import { getActiveLanguageCode } from '../lib/active-language';
import { getTodayDate } from '../lib/dates';

const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL || 'http://localhost:8765';

async function ankiRequest(action: string, params?: Record<string, unknown>) {
  const res = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
    // Bound the call so a reachable-but-hung AnkiConnect can't stall the route
    // until the server idle timeout (matches sync-reviews' timeout).
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`AnkiConnect HTTP error: ${res.status}`);
  return res.json();
}

function triggerSync() {
  // Fire-and-forget — don't block the card-add response.
  ankiRequest('sync').catch((err) => console.error('[Anki] sync failed:', err));
}

const app = new Hono();

// GET /api/anki — connection check + deck list
app.get('/', async (c) => {
  try {
    const [versionRes, decksRes] = await Promise.all([ankiRequest('version'), ankiRequest('deckNames')]);
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

// POST /api/anki — proxy an AnkiConnect action, auto-sync after addNote
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
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// sync-reviews — settings-aware URL resolution + a guard timeout (mirrors the
// Next /api/anki/sync-reviews route, which deliberately differs from the simple
// GET/POST proxy above).
// ---------------------------------------------------------------------------

const DEFAULT_ANKI_CONNECT_URL = 'http://localhost:8765';
// A closed port (Anki not running) refuses instantly; this only bites the rare
// reachable-but-stuck case.
const ANKI_TIMEOUT_MS = 2500;

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Resolve the same way the browser client does: the ankiConnectUrl setting
// wins (remote Anki over Tailscale etc.), then the env var, then localhost.
// The setting is user-editable, so require an http(s) URL before fetch()ing it
// (rejects file:// and other schemes); localhost stays valid — AnkiConnect is a
// local service, so we don't block private addresses here.
function getAnkiConnectUrl(): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE userId = ? AND key = ?').get(LOCAL_USER_ID, 'ankiConnectUrl') as
      | { value: string }
      | undefined;
    const raw = row?.value?.replace(/^"|"$/g, '').trim();
    if (raw && isHttpUrl(raw)) return raw;
  } catch {
    // fall through to env / default
  }
  return process.env.ANKI_CONNECT_URL || DEFAULT_ANKI_CONNECT_URL;
}

async function ankiRequestWithUrl<T>(
  url: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(ANKI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const data = (await res.json()) as { result: T; error: string | null };
  if (data.error) throw new Error(data.error);
  return data.result;
}

// POST /api/anki/sync-reviews — persist Anki's per-day review counts into
// dailyStats.ankiReviews so the heatmap/streak count Anki study days. Best-
// effort: an unreachable AnkiConnect leaves previously-synced data untouched.
app.post('/sync-reviews', async (c) => {
  const url = getAnkiConnectUrl();

  let byDay: Array<[string, number]>;
  try {
    byDay = await ankiRequestWithUrl<Array<[string, number]>>(url, 'getNumCardsReviewedByDay');
  } catch (err) {
    return c.json({
      connected: false,
      synced: 0,
      error: err instanceof Error ? err.message : 'Could not reach AnkiConnect',
    });
  }

  const language = getActiveLanguageCode();

  // Touch ONLY ankiReviews so the day's other counters are preserved.
  const upsert = db.prepare(
    `INSERT INTO dailyStats (userId, date, language, ankiReviews) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, date, language) DO UPDATE SET ankiReviews = excluded.ankiReviews`,
  );
  db.transaction((rows: Array<[string, number]>) => {
    for (const [date, count] of rows) {
      if (typeof date === 'string' && Number.isFinite(count)) {
        upsert.run(LOCAL_USER_ID, date, language, Math.trunc(count));
      }
    }
  })(byDay);

  const reviewsToday = byDay.find(([d]) => d === getTodayDate())?.[1] ?? 0;

  return c.json({ connected: true, synced: byDay.length, reviewsToday });
});

export default app;
