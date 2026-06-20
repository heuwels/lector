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
// The DB-touching functions take a `Database` argument (the codebase idiom for
// testable db code, cf. migrateLlmProviderSettings) so unit tests drive them
// against an in-memory DB with an injected classifier — no real LLM, no real DB.

import { Database } from 'bun:sqlite';
import { db } from '../db';
import { classifyWords, type ClassifyItem, type ClassifyResult } from './word-classifier';

// Only states that COUNT toward the radar are worth classifying — skip new/ignored
// to save calls. If such a word later reaches a mastery state it's still
// domain IS NULL, so the next sweep picks it up then.
const MASTERY_STATES = ['level1', 'level2', 'level3', 'level4', 'known'] as const;

export interface PendingRow {
  word: string;
  language: string;
  translation: string | null;
  sentence: string | null;
}

/**
 * Up to `limit` unclassified mastery-state words, each with a single
 * representative vocab encounter for context — preferring a row that carries an
 * example `sentence` (richest), then one with a translation, then the most
 * recent. A bulk-imported word with no vocab row at all yields NULL context and
 * is classified on the word alone (fuzzier, but still placed).
 */
export function selectPending(database: Database, limit: number): PendingRow[] {
  const placeholders = MASTERY_STATES.map(() => '?').join(',');
  return database
    .prepare(
      `SELECT kw.word AS word, kw.language AS language,
              v.translation AS translation, v.sentence AS sentence
         FROM knownWords kw
         LEFT JOIN vocab v ON v.id = (
           SELECT v2.id FROM vocab v2
            WHERE v2.text = kw.word AND v2.language = kw.language
            ORDER BY (v2.sentence != '') DESC, (v2.translation != '') DESC, v2.stateUpdatedAt DESC
            LIMIT 1
         )
        WHERE kw.domain IS NULL
          AND kw.state IN (${placeholders})
        ORDER BY kw.word, kw.language
        LIMIT ?`,
    )
    .all(...MASTERY_STATES, limit) as PendingRow[];
}

/**
 * One drain step: classify a batch of pending words and write their domains back
 * to `knownWords`, keyed by the compound PK (word, language). Returns how many
 * rows were written. `classify` is injectable so tests can stub the LLM.
 */
export async function classifyPendingBatch(
  database: Database,
  limit: number,
  classify: (items: ClassifyItem[]) => Promise<ClassifyResult[]> = classifyWords,
): Promise<number> {
  const rows = selectPending(database, limit);
  if (rows.length === 0) return 0;

  const results = await classify(
    rows.map((r) => ({
      word: r.word,
      translation: r.translation || undefined,
      sentence: r.sentence || undefined,
    })),
  );
  if (results.length === 0) return 0;

  const domainByWord = new Map(results.map((r) => [r.word, r.domain]));
  const update = database.prepare('UPDATE knownWords SET domain = ? WHERE word = ? AND language = ?');
  let updated = 0;
  const apply = database.transaction((batch: PendingRow[]) => {
    for (const r of batch) {
      const domain = domainByWord.get(r.word);
      if (domain) {
        update.run(domain, r.word, r.language);
        updated += 1;
      }
    }
  });
  apply(rows);
  return updated;
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
  const intervalMs = Math.max(1000, parseInt(process.env.CLASSIFY_INTERVAL_MS || '15000', 10) || 15000);

  const tick = async () => {
    if (ticking) return; // never overlap a slow LLM call
    ticking = true;
    try {
      const n = await classifyPendingBatch(db, batchSize);
      if (n > 0) console.log(`[classify-worker] classified ${n} word(s)`);
    } catch (err) {
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
