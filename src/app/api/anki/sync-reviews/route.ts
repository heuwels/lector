import { NextResponse } from 'next/server';
import { db } from '@/lib/server/database';
import { getActiveLanguageCode } from '@/lib/server/active-language';
import { getTodayDate } from '@/lib/server/dates';

const DEFAULT_ANKI_CONNECT_URL = 'http://localhost:8765';
// Guard against a hung AnkiConnect. A *closed* port (Anki not running) refuses
// the connection instantly, so this only bites the rare reachable-but-stuck case.
const ANKI_TIMEOUT_MS = 2500;

/**
 * Resolve the AnkiConnect URL the same way the browser client (src/lib/anki.ts)
 * does: the `ankiConnectUrl` setting wins (lets a user point at a remote Anki,
 * e.g. over Tailscale), then the env var, then localhost. Settings values are
 * stored JSON-encoded, so strip surrounding quotes.
 */
function getAnkiConnectUrl(): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ankiConnectUrl') as
      | { value: string }
      | undefined;
    const raw = row?.value?.replace(/^"|"$/g, '').trim();
    if (raw) return raw;
  } catch {
    // fall through to env / default
  }
  return process.env.ANKI_CONNECT_URL || DEFAULT_ANKI_CONNECT_URL;
}

async function ankiRequest<T>(
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

// POST /api/anki/sync-reviews
//
// Pull Anki's per-day review counts (getNumCardsReviewedByDay) and persist them
// into dailyStats.ankiReviews, so the activity heatmap and streak count Anki
// study days — even when Anki isn't running later.
//
// Best-effort by design: if AnkiConnect is unreachable we return
// { connected: false } and leave the previously-synced data untouched. That
// keeps the streak deterministic (it never silently drops Anki days just
// because the desktop app happens to be closed when the page loads).
export async function POST() {
  const url = getAnkiConnectUrl();

  let byDay: Array<[string, number]>;
  try {
    byDay = await ankiRequest<Array<[string, number]>>(url, 'getNumCardsReviewedByDay');
  } catch (err) {
    return NextResponse.json({
      connected: false,
      synced: 0,
      error: err instanceof Error ? err.message : 'Could not reach AnkiConnect',
    });
  }

  const language = getActiveLanguageCode();

  // Upsert each day's review count, touching ONLY ankiReviews so the day's
  // other counters (lookups, cloze, reading) are preserved. getNumCardsReviewedByDay
  // returns [date, count] pairs for days with reviews only — days with none are
  // left absent (correctly not Anki-active).
  const upsert = db.prepare(
    `INSERT INTO dailyStats (date, language, ankiReviews) VALUES (?, ?, ?)
     ON CONFLICT(date, language) DO UPDATE SET ankiReviews = excluded.ankiReviews`,
  );
  const writeAll = db.transaction((rows: Array<[string, number]>) => {
    for (const [date, count] of rows) {
      if (typeof date === 'string' && Number.isFinite(count)) {
        upsert.run(date, language, Math.trunc(count));
      }
    }
  });
  writeAll(byDay);

  const reviewsToday = byDay.find(([d]) => d === getTodayDate())?.[1] ?? 0;

  return NextResponse.json({ connected: true, synced: byDay.length, reviewsToday });
}
