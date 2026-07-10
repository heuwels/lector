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
}

export interface AnkiQueueResult {
  queued: number;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Enqueue vocab entries as pending Anki cards. Per-item problems (deleted
 * entry, cloze word missing from its sentence) come back in `failed` rather
 * than throwing; transport/HTTP failures throw.
 */
export async function queueForAnki(items: AnkiQueueItem[]): Promise<AnkiQueueResult> {
  const res = await apiFetch('/api/anki/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to queue cards for Anki');
  }
  return (await res.json()) as AnkiQueueResult;
}
