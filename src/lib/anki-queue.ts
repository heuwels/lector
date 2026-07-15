// Cloud-mode Anki transport (#241). The browser can't reach a local
// AnkiConnect from a hosted origin (Chrome's Local Network Access gates
// public HTTPS → loopback), so instead of adding cards directly the app
// queues them server-side; the Lector Anki addon pulls the queue from inside
// Anki Desktop, creates the notes, and acks. Selfhost keeps the direct
// browser→AnkiConnect path in src/lib/anki.ts.

import { apiFetch } from './api-base';

export type AnkiQueueCardType = 'basic' | 'word' | 'cloze';

export interface AnkiQueueItem {
  /** Vocab entry id — becomes the note's LectorId (the upsert key). */
  id: string;
  cardType: AnkiQueueCardType;
  /** Cloze target when it differs from the entry text (phrase blanks). */
  word?: string;
  /** Card sentence when it differs from the entry's stored sentence. */
  sentence?: string;
  translation?: string;
  meaning?: string;
  /** #334 — source video watch URL + segment start/end (ms) for a card mined
   *  from a transcript. The server renders these into the note's Source field. */
  sourceUrl?: string;
  clipStartMs?: number;
  clipEndMs?: number;
}

export interface AnkiQueueResult {
  queued: number;
  failed: Array<{ id: string; error: string }>;
}

/** The server rejects batches above this (routes/anki.ts MAX_QUEUE_ITEMS) —
 *  callers never need to care because queueForAnki chunks to it. */
export const QUEUE_BATCH_LIMIT = 500;

/**
 * Enqueue vocab entries as pending Anki cards. Batches larger than the
 * server's per-call ceiling are sent in chunks and the results merged, so a
 * bulk vocab-page export of any size works. Per-item problems (deleted
 * entry, cloze word missing from its sentence) come back in `failed` rather
 * than throwing; transport/HTTP failures throw.
 */
export async function queueForAnki(items: AnkiQueueItem[]): Promise<AnkiQueueResult> {
  const total: AnkiQueueResult = { queued: 0, failed: [] };
  for (let start = 0; start < items.length; start += QUEUE_BATCH_LIMIT) {
    const chunk = items.slice(start, start + QUEUE_BATCH_LIMIT);
    const res = await apiFetch('/api/anki/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: chunk }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || 'Failed to queue cards for Anki');
    }
    const result = (await res.json()) as AnkiQueueResult;
    total.queued += result.queued;
    total.failed.push(...result.failed);
  }
  return total;
}
