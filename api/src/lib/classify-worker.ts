// Background word→domain classifier worker. Runs an in-process drain loop in the
// HONO PROCESS ONLY (the LLM provider lives here) — never in the Next process,
// or you'd get two racing classifiers. Boots only when CLASSIFY_WORKER=1, so it
// stays off under test/e2e and in any process that doesn't opt in.
//
// Restart-safe + self-draining: the entire to-do list is `domain IS NULL` rows
// in the DB, so a restart simply resumes and the first sweep chews through every
// pre-existing unclassified word — there is no separate backfill job. Idempotent:
// only NULL-domain rows are ever touched, and a word's domain is never rewritten.
//
// Two drain modes (#226): when the classification provider exposes a Batch API
// (Anthropic Message Batches — 50% of synchronous pricing), the worker submits
// one large batch job and polls it each tick, persisting the in-flight batch in
// `classify_batches` so a restart resumes polling rather than re-paying for the
// same words. Providers without a batch surface (LM Studio, Ollama, OpenRouter)
// and the Anthropic OAuth path keep the original synchronous per-tick drain.
// Classification was never latency-sensitive — nothing in the UI waits on it —
// so trading minutes of extra latency for half price is free money.
//
// The DB-touching functions take a `Database` argument (the codebase idiom for
// testable db code, cf. migrateLlmProviderSettings) so unit tests drive them
// against an in-memory DB with an injected classifier — no real LLM, no real DB.

import { Database } from 'bun:sqlite';
import { db } from '../db';
import { MASTERY_STATES } from './domains';
import {
  buildClassifyPrompt,
  classifyMaxTokens,
  classifyWords,
  parseClassifyBatchText,
  type ClassifyItem,
  type ClassifyResult,
} from './word-classifier';
import { getClassificationProvider, type LLMProvider } from './llm';
import type { BatchRequest } from './llm';
import { Sentry } from './sentry';

// Only states that COUNT toward the radar are worth classifying (MASTERY_STATES,
// shared with the radar aggregation) — skip new/ignored to save calls. If such a
// word later reaches a mastery state it's still domain IS NULL, so the next sweep
// picks it up then.

export interface PendingRow {
  userId: string;
  word: string;
  language: string;
  translation: string | null;
  sentence: string | null;
}

/**
 * Up to `limit` unclassified mastery-state words across EVERY tenant (#220 —
 * the worker has no request context, so it sweeps all users; each word's
 * vocab context comes from that same user's rows), each with a single
 * representative vocab encounter for context — preferring a row that carries an
 * example `sentence` (richest), then one with a translation, then the most
 * recent. A bulk-imported word with no vocab row at all yields NULL context and
 * is classified on the word alone (fuzzier, but still placed).
 */
export function selectPending(database: Database, limit: number): PendingRow[] {
  const placeholders = MASTERY_STATES.map(() => '?').join(',');
  return database
    .prepare(
      `SELECT kw.userId AS userId, kw.word AS word, kw.language AS language,
              v.translation AS translation, v.sentence AS sentence
         FROM knownWords kw
         LEFT JOIN vocab v ON v.id = (
           SELECT v2.id FROM vocab v2
            WHERE v2.userId = kw.userId AND v2.text = kw.word AND v2.language = kw.language
            ORDER BY (v2.sentence != '') DESC, (v2.translation != '') DESC, v2.stateUpdatedAt DESC
            LIMIT 1
         )
        WHERE kw.domain IS NULL
          AND kw.state IN (${placeholders})
        ORDER BY kw.userId, kw.word, kw.language
        LIMIT ?`,
    )
    .all(...MASTERY_STATES, limit) as PendingRow[];
}

/**
 * One drain step: classify a batch of pending words and write their domains back
 * to `knownWords`, keyed by the compound PK (word, language). Returns how many
 * rows were written. `classify` is injectable so tests can stub the LLM.
 */
/** The prompt context for a pending row — one mapping for sync AND batch mode. */
function itemsFromRows(rows: PendingRow[]): ClassifyItem[] {
  return rows.map((r) => ({
    word: r.word,
    translation: r.translation || undefined,
    sentence: r.sentence || undefined,
  }));
}

/**
 * Write classified domains back to the exact rows that were submitted, keyed by
 * word text within the submitted set. `AND domain IS NULL` keeps this safe to
 * replay: a row classified elsewhere in the meantime is never rewritten.
 */
function applyResults(database: Database, rows: PendingRow[], results: ClassifyResult[]): number {
  if (results.length === 0) return 0;
  const domainByWord = new Map(results.map((r) => [r.word, r.domain]));
  const update = database.prepare(
    'UPDATE knownWords SET domain = ? WHERE userId = ? AND word = ? AND language = ? AND domain IS NULL',
  );
  let updated = 0;
  const apply = database.transaction((batch: PendingRow[]) => {
    for (const r of batch) {
      const domain = domainByWord.get(r.word);
      if (domain) {
        updated += update.run(domain, r.userId, r.word, r.language).changes;
      }
    }
  });
  apply(rows);
  return updated;
}

export async function classifyPendingBatch(
  database: Database,
  limit: number,
  classify: (items: ClassifyItem[]) => Promise<ClassifyResult[]> = classifyWords,
): Promise<number> {
  const rows = selectPending(database, limit);
  if (rows.length === 0) return 0;

  const results = await classify(itemsFromRows(rows));
  return applyResults(database, rows, results);
}

// ── Batch-mode drain (#226) ──────────────────────────────────────────────────

/** The slice of LLMProvider the batch drain needs — tests stub just this. */
export type BatchClassifyProvider = Pick<
  LLMProvider,
  'name' | 'supportsBatch' | 'createBatch' | 'getBatch'
>;

/**
 * Batch mode is on whenever the provider can do it, because it halves the cost
 * of identical work; CLASSIFY_BATCH=0 opts a deployment back into synchronous
 * draining (e.g. to refill a fresh install's radar in seconds, not minutes).
 */
export function batchClassificationEnabled(provider: BatchClassifyProvider): boolean {
  if (process.env.CLASSIFY_BATCH === '0') return false;
  return provider.supportsBatch?.() === true;
}

interface StoredBatchRequest {
  customId: string;
  rows: PendingRow[];
}

interface InflightBatch {
  id: number;
  providerBatchId: string;
  provider: string;
  requests: StoredBatchRequest[];
}

export function getInflightBatch(database: Database): InflightBatch | null {
  const row = database
    .prepare(
      'SELECT id, providerBatchId, provider, requests FROM classify_batches ORDER BY id LIMIT 1',
    )
    .get() as { id: number; providerBatchId: string; provider: string; requests: string } | null;
  if (!row) return null;
  return { ...row, requests: JSON.parse(row.requests) as StoredBatchRequest[] };
}

/**
 * Submit one provider batch covering up to batchSize×maxRequests pending words,
 * chunked into prompts of batchSize words (the same prompt shape the sync path
 * sends). Records the batch in classify_batches AFTER the provider accepted it.
 * Returns the number of words submitted (0 when nothing is pending or a batch
 * is already in flight — only one runs at a time, so a submit can never race
 * the poll of an earlier batch over the same NULL-domain rows).
 */
export async function submitClassifyBatch(
  database: Database,
  provider: BatchClassifyProvider,
  batchSize: number,
  maxRequests: number,
): Promise<number> {
  if (getInflightBatch(database)) return 0;
  const rows = selectPending(database, batchSize * maxRequests);
  if (rows.length === 0) return 0;

  const stored: StoredBatchRequest[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    stored.push({ customId: `req-${stored.length}`, rows: rows.slice(i, i + batchSize) });
  }
  const requests: BatchRequest[] = stored.map((request) => ({
    customId: request.customId,
    options: {
      messages: [{ role: 'user', content: buildClassifyPrompt(itemsFromRows(request.rows)) }],
      maxTokens: classifyMaxTokens(request.rows.length),
      task: 'word-classification',
      responseFormat: 'json-array',
    },
  }));

  const providerBatchId = await provider.createBatch!(requests);
  database
    .prepare(
      'INSERT INTO classify_batches (providerBatchId, provider, submittedAt, requests) VALUES (?, ?, ?, ?)',
    )
    .run(providerBatchId, provider.name, new Date().toISOString(), JSON.stringify(stored));
  return rows.length;
}

export type BatchPollOutcome =
  | { state: 'none' }
  | { state: 'in_progress' }
  | { state: 'ended'; updated: number }
  | { state: 'failed'; error: string };

/**
 * Poll the in-flight batch, if any. On completion, parse each request's text
 * with the same drop rules as the sync path and write domains back to exactly
 * the rows that were submitted; requests that errored/expired (absent from
 * results) or parsed to garbage classify nothing — their words are still
 * domain IS NULL, so the next submit sweeps them up again. The bookkeeping row
 * is deleted on any terminal state, which is what re-arms submission.
 */
export async function pollClassifyBatch(
  database: Database,
  provider: BatchClassifyProvider,
): Promise<BatchPollOutcome> {
  const inflight = getInflightBatch(database);
  if (!inflight) return { state: 'none' };

  const status = await provider.getBatch!(inflight.providerBatchId);
  if (status.state === 'in_progress') return { state: 'in_progress' };

  const clear = () =>
    database.prepare('DELETE FROM classify_batches WHERE id = ?').run(inflight.id);

  if (status.state === 'failed') {
    clear();
    return { state: 'failed', error: status.error };
  }

  let updated = 0;
  for (const request of inflight.requests) {
    const text = status.results.get(request.customId);
    if (!text) continue;
    const items = itemsFromRows(request.rows);
    updated += applyResults(database, request.rows, parseClassifyBatchText(items, text));
  }
  clear();
  return { state: 'ended', updated };
}

/**
 * Drop in-flight batch bookkeeping when batch mode is unavailable (provider or
 * config changed under a live batch). The orphaned batch's results are simply
 * never fetched — its words are still domain IS NULL, so the sync path
 * reclassifies them. Deterministic beats a zombie row that blocks nothing but
 * lives forever.
 */
export function purgeOrphanedBatches(database: Database): number {
  const purged = database.prepare('DELETE FROM classify_batches').run().changes;
  if (purged > 0) {
    console.warn(
      `[classify-worker] purged ${purged} in-flight batch(es) — batch mode no longer available; their words will re-classify synchronously`,
    );
  }
  return purged;
}

/** True when this process is configured to run the classifier loop. */
export function classifyWorkerEnabled(): boolean {
  return process.env.CLASSIFY_WORKER === '1';
}

let loopTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

/**
 * Boot the drain loop (Hono process only). No-op unless CLASSIFY_WORKER=1.
 * Returns whether it actually started, so callers/tests can assert the gate.
 * Batch size + interval are env-tunable so a fresh backfill can be paced to
 * drain in minutes without hammering the API key.
 */
export function startClassifyWorker(): boolean {
  if (!classifyWorkerEnabled()) return false;
  if (loopTimer) return true; // already running

  const batchSize = Math.max(1, parseInt(process.env.CLASSIFY_BATCH_SIZE || '30', 10) || 30);
  const intervalMs = Math.max(
    1000,
    parseInt(process.env.CLASSIFY_INTERVAL_MS || '15000', 10) || 15000,
  );
  // How many prompts of batchSize words one provider batch may carry — 40×30 =
  // up to 1,200 words per submission, big enough to drain a bulk import in a
  // couple of batch turnarounds without approaching provider request caps.
  const maxBatchRequests = Math.max(
    1,
    parseInt(process.env.CLASSIFY_BATCH_MAX_REQUESTS || '40', 10) || 40,
  );

  const tick = async () => {
    if (ticking) return; // never overlap a slow LLM call
    ticking = true;
    try {
      // Each drain is its own root trace (no inbound request). Wrapping it in a
      // span means a failed LLM classification surfaces in Sentry with a full
      // worker stack trace + timing, instead of being swallowed as a console
      // line — this background loop has no request handler to bubble errors to.
      await Sentry.startSpan(
        { name: 'classify-worker.tick', op: 'queue.process' },
        async () => {
          // Resolved per tick, not at boot: settings changes (resetProvider)
          // can swap the provider — and with it batch support — under a
          // long-lived loop.
          const provider = getClassificationProvider();
          if (batchClassificationEnabled(provider)) {
            const poll = await pollClassifyBatch(db, provider);
            if (poll.state === 'ended') {
              console.log(`[classify-worker] batch classified ${poll.updated} word(s)`);
            } else if (poll.state === 'failed') {
              console.warn(`[classify-worker] batch failed (${poll.error}) — will resubmit`);
            } else if (poll.state === 'none') {
              const submitted = await submitClassifyBatch(db, provider, batchSize, maxBatchRequests);
              if (submitted > 0) {
                console.log(`[classify-worker] submitted batch of ${submitted} word(s)`);
              }
            }
          } else {
            purgeOrphanedBatches(db);
            const n = await classifyPendingBatch(db, batchSize);
            if (n > 0) console.log(`[classify-worker] classified ${n} word(s)`);
          }
        },
      );
    } catch (err) {
      Sentry.captureException(err);
      console.error('[classify-worker] tick failed:', err);
    } finally {
      ticking = false;
    }
  };

  loopTimer = setInterval(tick, intervalMs);
  loopTimer.unref?.();
  // First drain shortly after boot, without blocking startup.
  kickTimer = setTimeout(tick, 1000);
  kickTimer.unref?.();
  console.log(`[classify-worker] enabled (batch=${batchSize}, every ${intervalMs}ms)`);
  return true;
}

/** Stop the loop and cancel any pending first-drain kick (tests / shutdown). */
export function stopClassifyWorker(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
}
