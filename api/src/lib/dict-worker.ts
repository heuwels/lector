/**
 * Keep DICT_DIR in step with the languages this box needs (#438).
 *
 * The published image ships no dictionaries. This loop reconciles what is on
 * disk against what the box wants, and downloads the difference. It reads
 * state, it does not react to events. That matters: a self-hoster who is
 * already mid-way through German never "adds" a language, so an event-driven
 * fetch would leave that box on the AI fallback forever.
 *
 *   want = DICT_LANGS  ∪  the languages the accounts opted into
 *   have = the installed manifest in DICT_DIR
 *   fetch(want − have)
 *
 * The account half comes from `enabledLanguages` (#442). `migrateEnabledLanguages`
 * in db.ts writes that list at boot for an account that predates the opt-in
 * picker, from the target language plus every language the account rows carry.
 * So the list is complete for every account, new or old.
 *
 * Cloud does not rely on the account half. It sets `DICT_LANGS=all` and takes
 * every pinned dictionary, because a paying learner must never wait on a
 * download that nobody triggered yet.
 *
 * The loop never gates readiness. A missing dictionary degrades to the AI
 * lookup path, which is what the runtime already does today.
 */
import type { Database } from 'bun:sqlite';
import { Sentry } from './sentry';
import { db } from '../db';
import { dictPins } from './dict-pins';
import {
  adoptUnrecorded,
  installDictionary,
  isInstalled,
  readInstalledManifest,
  sweepPartFiles,
} from './dict-install';
import { dictionaryDir } from './dictionary-db';
import { isValidLanguageCode, normalizeEnabledLanguages } from './languages';

/** Where one language sits. The Settings panel in Phase 2 reads these. */
export type DictState = 'installed' | 'pending' | 'downloading' | 'error';

export interface DictStatus {
  language: string;
  state: DictState;
  version?: string;
  error?: string;
  attempts: number;
  /** Epoch ms before which a failed language is not retried. */
  retryAfter?: number;
}

/**
 * Failures back off, they never stop. A language that fails is retried after
 * `RETRY_BACKOFF_MS[attempts]`, and the last entry repeats forever.
 *
 * A permanent give-up was wrong here. A short GitHub outage at boot would park
 * a language on the AI lookup for the life of the process, which on a cloud box
 * means until the next deploy. Nothing else ever retries it.
 */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** Failures before the shortfall is reported as an error rather than a warning. */
const ALERT_AFTER_ATTEMPTS = 3;

const statuses = new Map<string, DictStatus>();

function status(language: string): DictStatus {
  let entry = statuses.get(language);
  if (!entry) {
    entry = { language, state: 'pending', attempts: 0 };
    statuses.set(language, entry);
  }
  return entry;
}

/** Every language this process knows the state of. */
export function dictStatuses(): DictStatus[] {
  return [...statuses.values()].sort((a, b) => a.language.localeCompare(b.language));
}

/**
 * The languages named by DICT_LANGS. `all` means every pinned language, which
 * is what cloud sets. An unset value means "ask the accounts instead".
 */
export function requestedLanguages(raw = process.env.DICT_LANGS): string[] {
  const value = (raw || '').trim();
  if (!value) return [];
  if (value.toLowerCase() === 'all') return [...dictPins().published];
  return value
    .split(/[\s,]+/)
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The languages the accounts on this box opted into. Reads `enabledLanguages`
 * and, defensively, `targetLanguage`: every writer of the target also calls
 * `ensureLanguageEnabled`, so the two agree, but a dictionary is too cheap to
 * lose over a write that lands between the two statements.
 */
export function accountLanguages(database: Database = db): string[] {
  const codes = new Set<string>();
  try {
    const rows = database
      .prepare("SELECT key, value FROM settings WHERE key IN ('enabledLanguages', 'targetLanguage')")
      .all() as { key: string; value: string }[];
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        continue;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const code of normalizeEnabledLanguages(list)) codes.add(code);
    }
  } catch (err) {
    // A box whose settings table is not built yet simply wants nothing.
    console.warn('[dict-worker] could not read the opted-in languages:', err);
  }
  return [...codes];
}

/** The full want-set, with unpinned and unknown codes dropped. */
export function wantedLanguages(database: Database = db): string[] {
  const pins = dictPins().pins;
  const wanted = new Set(requestedLanguages());
  if (process.env.DICT_AUTO_INSTALL !== '0') {
    for (const code of accountLanguages(database)) wanted.add(code);
  }
  return [...wanted].filter((code) => isValidLanguageCode(code) && Boolean(pins[code])).sort();
}

/** The want-set minus what DICT_DIR already holds at the pinned version. */
export function missingLanguages(dir = dictionaryDir(), database: Database = db): string[] {
  const pins = dictPins().pins;
  const manifest = readInstalledManifest(dir);
  return wantedLanguages(database).filter((code) => !isInstalled(code, pins[code]!, manifest, dir));
}

/**
 * One reconcile pass. Downloads the missing languages one at a time, so a box
 * that wants twenty of them does not open twenty sockets to GitHub.
 */
export async function reconcileDictionaries(
  signal?: AbortSignal,
  now = () => Date.now(),
): Promise<void> {
  const dir = dictionaryDir();

  // A container killed mid-download leaves its part file behind, under a pid
  // this process will never reuse. Clear those before adding more.
  sweepPartFiles(dir);
  // Record anything already on disk that the manifest does not name, so a pin
  // change can replace it later.
  adoptUnrecorded(dictPins().pins, dir);

  for (const language of missingLanguages(dir)) {
    if (signal?.aborted) return;
    const entry = status(language);
    if (entry.retryAfter && now() < entry.retryAfter) continue;
    entry.state = 'downloading';
    try {
      const installed = await installDictionary(language, { dir, signal });
      entry.state = 'installed';
      entry.version = installed.version;
      entry.error = undefined;
      entry.attempts = 0;
      entry.retryAfter = undefined;
      console.log(`[dict-worker] installed ${language} (${installed.version})`);
    } catch (err) {
      if (signal?.aborted) return; // Shutdown, not a failure worth counting.
      entry.attempts += 1;
      entry.state = 'error';
      entry.error = String(err);
      const backoff =
        RETRY_BACKOFF_MS[Math.min(entry.attempts - 1, RETRY_BACKOFF_MS.length - 1)]!;
      entry.retryAfter = now() + backoff;
      console.warn(
        `[dict-worker] ${language} failed (attempt ${entry.attempts}, retry in ${Math.round(backoff / 1000)}s): ${entry.error}`,
      );
      // Report once, at the point where this stops looking like a blip. Every
      // later attempt keeps retrying without adding noise.
      if (entry.attempts === ALERT_AFTER_ATTEMPTS) Sentry.captureException(err);
    }
  }
}

/**
 * Warn when the box wants a language it does not hold. Cloud runs on this line:
 * a box silently missing a dictionary serves every word through the slower,
 * costlier AI path. It is a warning, never a boot failure.
 */
export function reportShortfall(): string[] {
  const missing = missingLanguages();
  if (missing.length === 0) return missing;

  const message = `requested but not installed: ${missing.join(', ')} — those languages use the AI lookup path until the download lands`;
  console.warn(`[dict-worker] ${message}`);

  // #438 asked for an alert on requested-vs-installed, not just a log line. At
  // boot every requested language is legitimately missing, so this is a
  // breadcrumb rather than an error. The error is raised by the retry loop,
  // once a language has failed enough times to mean something is wrong.
  Sentry.addBreadcrumb({
    category: 'dict',
    level: 'warning',
    message,
    data: { missing, requested: wantedLanguages().length },
  });
  return missing;
}

/**
 * Languages still missing once the loop has had time to work through the queue.
 *
 * This is the requested-vs-installed alert #438 asked for, and it is separate
 * from the per-failure report above. A language can be missing without ever
 * failing, because it is simply queued behind nineteen others. Still missing
 * much later means the box is paying for every lookup in that language through
 * the AI path, whatever the reason.
 */
export function reportPersistentShortfall(): string[] {
  const missing = missingLanguages();
  if (missing.length === 0) return [];
  Sentry.captureMessage(
    `[dict-worker] still missing ${missing.length} requested dictionar${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')}`,
    'error',
  );
  console.error(
    `[dict-worker] still missing after the settle window: ${missing.join(', ')} — every lookup in those languages uses the AI path`,
  );
  return missing;
}

let loopTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let ticking = false;

/**
 * How long the loop gets to work through the queue before a still-missing
 * dictionary counts as a problem. A first cloud boot fetches twenty of them in
 * sequence, so this has to be generous.
 */
function settleWindowMs(): number {
  const raw = parseInt(process.env.DICT_SETTLE_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

/**
 * True when this process fetches dictionaries at runtime.
 *
 * Unlike the classify and transcribe workers this one is ON by default, because
 * a slim image with the fetch turned off is an app with no dictionaries. The
 * three ways it stays quiet:
 *
 * - `DICT_FETCH=0` turns it off. Air-gapped boxes and the `:full` image use it,
 *   and so does the e2e job that pre-seeds DICT_DIR.
 * - No pin manifest means there is nothing it could fetch.
 * - Tests never reach the network unless they ask for it with `DICT_FETCH=1`.
 */
export function dictWorkerEnabled(): boolean {
  if (process.env.DICT_FETCH === '0') return false;
  if (dictPins().published.length === 0) return false;
  if (process.env.DICT_FETCH === '1') return true;
  return process.env.NODE_ENV !== 'test';
}

/**
 * Boot the reconcile loop (Hono process only). Returns whether it started.
 *
 * The interval is what makes an opt-in show up without any event plumbing. A
 * learner adds a language, the next tick sees the wider want-set, and the
 * download starts. The language works through the AI fallback in the meantime.
 */
export function startDictWorker(): boolean {
  if (!dictWorkerEnabled()) return false;
  if (loopTimer) return true;

  const intervalMs = Math.max(
    5000,
    parseInt(process.env.DICT_INTERVAL_MS || '60000', 10) || 60000,
  );
  controller = new AbortController();

  const tick = async () => {
    if (ticking) return; // never overlap a running download
    ticking = true;
    try {
      await Sentry.startSpan({ name: 'dict-worker.tick', op: 'queue.process' }, () =>
        reconcileDictionaries(controller?.signal),
      );
    } catch (err) {
      Sentry.captureException(err);
      console.error('[dict-worker] tick failed:', err);
    } finally {
      ticking = false;
    }
  };

  reportShortfall();
  loopTimer = setInterval(tick, intervalMs);
  loopTimer.unref?.();
  // First pass shortly after boot, so the API starts serving straight away.
  kickTimer = setTimeout(tick, 1000);
  kickTimer.unref?.();
  // One alert, once the loop has had time to drain the queue.
  settleTimer = setTimeout(reportPersistentShortfall, settleWindowMs());
  settleTimer.unref?.();
  console.log(`[dict-worker] enabled (every ${intervalMs}ms, DICT_DIR=${dictionaryDir()})`);
  return true;
}

/** Stop the loop and abort an in-flight download (tests / shutdown). */
export function stopDictWorker(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  if (kickTimer) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  controller?.abort();
  controller = null;
}

/** Forget the recorded states (tests). */
export function resetDictStatuses(): void {
  statuses.clear();
}
