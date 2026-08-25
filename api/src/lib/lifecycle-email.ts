/**
 * Cloud lifecycle mail (#558). Sends published Resend templates. Each user
 * gets each template once. Self-host skips this module. A transport error
 * must not fail the flow that triggered the send.
 */
import { Database } from 'bun:sqlite';
import { db } from '../db';
import { config } from './config';
import { sendEmail, type EmailMessage } from './email';
import {
  isUnsubscribed,
  listUnsubscribeHeaders,
  unsubscribeUrl,
} from './email-unsubscribe';
import { LANGUAGES, isValidLanguageCode } from './languages';
import { Sentry } from './sentry';

export const LIFECYCLE_TEMPLATES = {
  welcome: 'welcome-on-account-create',
  day1: 'day-1-registered-no-word-saved',
  day3: 'day-3-registered-no-real-use',
  anki: 'anki-after-10-saved-words',
  glossCap: 'gloss-cap-free-tier-limit-hit',
} as const;

export type LifecycleAlias = (typeof LIFECYCLE_TEMPLATES)[keyof typeof LIFECYCLE_TEMPLATES];

export const ANKI_WORD_THRESHOLD = 10;
const HOUR_MS = 60 * 60 * 1000;
/** Day-1 is only for accounts that just crossed 24 hours. */
export const DAY1_AFTER_MS = 24 * HOUR_MS;
export const DAY1_UNTIL_MS = 72 * HOUR_MS;
/** Day-3 is only for accounts that just crossed 72 hours. */
export const DAY3_AFTER_MS = 72 * HOUR_MS;
export const DAY3_UNTIL_MS = 7 * 24 * HOUR_MS;

const UNSUBSCRIBE_ALIASES = new Set<LifecycleAlias>([
  LIFECYCLE_TEMPLATES.day1,
  LIFECYCLE_TEMPLATES.day3,
  LIFECYCLE_TEMPLATES.anki,
  LIFECYCLE_TEMPLATES.glossCap,
]);

const REAL_USE_EVENTS = [
  'lesson.opened',
  'vocab.saved',
  'practice.answer_submitted',
  'onboarding.completed',
] as const;

export type LifecycleSendResult = 'sent' | 'skipped';

export interface LifecycleUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: number | boolean;
  createdAt: string | number;
}

export interface LifecycleDeps {
  database: Database;
  now: () => Date;
  send: (message: EmailMessage) => Promise<void>;
  cloud: boolean;
  hasResendKey: boolean;
  appUrl: string;
}

export function defaultLifecycleDeps(): LifecycleDeps {
  return {
    database: db,
    now: () => new Date(),
    send: sendEmail,
    cloud: config.authRequired,
    hasResendKey: Boolean(process.env.RESEND_API_KEY),
    appUrl: process.env.BETTER_AUTH_URL || process.env.APP_URL || 'https://app.lector.dev',
  };
}

function mergeDeps(overrides?: Partial<LifecycleDeps>): LifecycleDeps {
  return { ...defaultLifecycleDeps(), ...overrides };
}

function userTableExists(database: Database): boolean {
  return Boolean(
    database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").get(),
  );
}

function isVerified(value: number | boolean): boolean {
  return value === 1 || value === true;
}

/** Parse Better Auth `createdAt` (ISO, Date, ms, or unix seconds). Null if unknown. */
export function createdAtMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      if (!Number.isFinite(asNumber)) return null;
      return asNumber < 1e11 ? asNumber * 1000 : asNumber;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function languageLabel(database: Database, userId: string): string {
  const row = database
    .prepare('SELECT value FROM settings WHERE userId = ? AND key = ?')
    .get(userId, 'targetLanguage') as { value: string } | undefined;
  if (!row) return 'your language';
  const raw = row.value.replace(/^"|"$/g, '');
  if (!isValidLanguageCode(raw)) return 'your language';
  return LANGUAGES[raw].name;
}

function alreadySent(database: Database, userId: string, alias: LifecycleAlias): boolean {
  return Boolean(
    database
      .prepare('SELECT 1 FROM email_sends WHERE userId = ? AND templateAlias = ?')
      .get(userId, alias),
  );
}

/** Insert the send row. Returns false when this user already has the alias. */
function claimSend(
  database: Database,
  userId: string,
  alias: LifecycleAlias,
  sentAt: string,
): boolean {
  const result = database
    .prepare('INSERT OR IGNORE INTO email_sends (userId, templateAlias, sentAt) VALUES (?, ?, ?)')
    .run(userId, alias, sentAt);
  return result.changes > 0;
}

function releaseSend(database: Database, userId: string, alias: LifecycleAlias): void {
  database
    .prepare('DELETE FROM email_sends WHERE userId = ? AND templateAlias = ?')
    .run(userId, alias);
}

function loadUser(database: Database, userId: string): LifecycleUser | null {
  if (!userTableExists(database)) return null;
  return (
    (database
      .prepare('SELECT id, email, name, emailVerified, createdAt FROM user WHERE id = ?')
      .get(userId) as LifecycleUser | undefined) ?? null
  );
}

function loadVerifiedUsers(database: Database): LifecycleUser[] {
  if (!userTableExists(database)) return [];
  return database
    .prepare(
      'SELECT id, email, name, emailVerified, createdAt FROM user WHERE emailVerified = 1',
    )
    .all() as LifecycleUser[];
}

export function savedWordCount(database: Database, userId: string): number {
  return (
    database
      .prepare("SELECT COUNT(*) AS c FROM vocab WHERE userId = ? AND state != 'ignored'")
      .get(userId) as { c: number }
  ).c;
}

export function hasRealUse(database: Database, userId: string): boolean {
  if (savedWordCount(database, userId) > 0) return true;
  const placeholders = REAL_USE_EVENTS.map(() => '?').join(',');
  const event = database
    .prepare(
      `SELECT 1 AS ok FROM learner_events WHERE userId = ? AND eventType IN (${placeholders}) LIMIT 1`,
    )
    .get(userId, ...REAL_USE_EVENTS) as { ok: number } | undefined;
  if (event) return true;
  const read = database
    .prepare(
      `SELECT 1 AS ok FROM lessons
        WHERE userId = ? AND (progress_percentComplete > 0 OR progress_scrollPosition > 0)
        LIMIT 1`,
    )
    .get(userId) as { ok: number } | undefined;
  return Boolean(read);
}

async function sendOnce(
  user: LifecycleUser,
  alias: LifecycleAlias,
  deps: LifecycleDeps,
): Promise<LifecycleSendResult> {
  if (!deps.cloud || !deps.hasResendKey) return 'skipped';
  if (!isVerified(user.emailVerified) || !user.email) return 'skipped';
  if (alreadySent(deps.database, user.id, alias)) return 'skipped';
  if (isUnsubscribed(deps.database, user.email)) return 'skipped';

  const sentAt = deps.now().toISOString();
  if (!claimSend(deps.database, user.id, alias, sentAt)) return 'skipped';

  const stopUrl = unsubscribeUrl(deps.appUrl, user.email);
  const wantsStop = UNSUBSCRIBE_ALIASES.has(alias);

  try {
    await deps.send({
      to: user.email,
      subject: alias,
      text: alias,
      headers: wantsStop && stopUrl ? listUnsubscribeHeaders(stopUrl) : undefined,
      template: {
        id: alias,
        variables: {
          USER_NAME: user.name?.trim() || 'there',
          LANGUAGE: languageLabel(deps.database, user.id),
          APP_URL: deps.appUrl,
          STOP_URL: stopUrl || `${deps.appUrl.replace(/\/$/, '')}/api/email/unsubscribe`,
        },
      },
    });
    return 'sent';
  } catch (err) {
    releaseSend(deps.database, user.id, alias);
    console.error(`[lifecycle-email] failed to send ${alias} to ${user.email}:`, err);
    Sentry.captureException(err);
    return 'skipped';
  }
}

/**
 * Welcome is hook-only. The sweep does not send it. If the app is not
 * cloud, or RESEND_API_KEY is absent, sendOnce returns skipped and writes
 * no email_sends row. That send does not retry later. That is a decision,
 * not a gap.
 */
export async function sendWelcomeEmail(
  userId: string,
  overrides?: Partial<LifecycleDeps>,
): Promise<LifecycleSendResult> {
  try {
    const deps = mergeDeps(overrides);
    const user = loadUser(deps.database, userId);
    if (!user) return 'skipped';
    return await sendOnce(user, LIFECYCLE_TEMPLATES.welcome, deps);
  } catch (err) {
    console.error(`[lifecycle-email] welcome failed for ${userId}:`, err);
    Sentry.captureException(err);
    return 'skipped';
  }
}

export async function notifyVocabSaved(
  userId: string,
  overrides?: Partial<LifecycleDeps>,
): Promise<LifecycleSendResult> {
  try {
    const deps = mergeDeps(overrides);
    if (savedWordCount(deps.database, userId) < ANKI_WORD_THRESHOLD) return 'skipped';
    const user = loadUser(deps.database, userId);
    if (!user) return 'skipped';
    return await sendOnce(user, LIFECYCLE_TEMPLATES.anki, deps);
  } catch (err) {
    console.error(`[lifecycle-email] anki notify failed for ${userId}:`, err);
    Sentry.captureException(err);
    return 'skipped';
  }
}

export async function notifyGlossCapHit(
  userId: string,
  overrides?: Partial<LifecycleDeps>,
): Promise<LifecycleSendResult> {
  try {
    const deps = mergeDeps(overrides);
    const user = loadUser(deps.database, userId);
    if (!user) return 'skipped';
    return await sendOnce(user, LIFECYCLE_TEMPLATES.glossCap, deps);
  } catch (err) {
    console.error(`[lifecycle-email] gloss-cap notify failed for ${userId}:`, err);
    Sentry.captureException(err);
    return 'skipped';
  }
}

export async function sweepLifecycleEmails(
  overrides?: Partial<LifecycleDeps>,
): Promise<{ sent: number; skipped: number }> {
  try {
    const deps = mergeDeps(overrides);
    let sent = 0;
    let skipped = 0;
    if (!deps.cloud || !deps.hasResendKey) return { sent, skipped };

    const nowMs = deps.now().getTime();
    for (const user of loadVerifiedUsers(deps.database)) {
      const createdMs = createdAtMs(user.createdAt);
      if (createdMs == null) continue;
      const ageMs = nowMs - createdMs;
      if (ageMs < 0 || ageMs >= DAY3_UNTIL_MS) continue;
      const results: LifecycleSendResult[] = [];
      // Welcome is hook-only. The first sweep sent every template to every
      // verified user because it had no upper age bound.
      if (
        ageMs >= DAY1_AFTER_MS &&
        ageMs < DAY1_UNTIL_MS &&
        savedWordCount(deps.database, user.id) === 0
      ) {
        results.push(await sendOnce(user, LIFECYCLE_TEMPLATES.day1, deps));
      }
      if (
        ageMs >= DAY3_AFTER_MS &&
        ageMs < DAY3_UNTIL_MS &&
        !hasRealUse(deps.database, user.id)
      ) {
        results.push(await sendOnce(user, LIFECYCLE_TEMPLATES.day3, deps));
      }
      for (const result of results) {
        if (result === 'sent') sent += 1;
        else skipped += 1;
      }
    }
    return { sent, skipped };
  } catch (err) {
    console.error('[lifecycle-email] sweep failed:', err);
    Sentry.captureException(err);
    return { sent: 0, skipped: 0 };
  }
}

function lifecycleWorkerEnabled(): boolean {
  return config.authRequired;
}

let loopTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

export function startLifecycleEmailWorker(): boolean {
  if (!lifecycleWorkerEnabled()) return false;
  if (loopTimer) return true;

  const intervalMs = Math.max(
    60_000,
    parseInt(process.env.LIFECYCLE_EMAIL_INTERVAL_MS || String(15 * 60_000), 10) || 15 * 60_000,
  );

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const { sent } = await sweepLifecycleEmails();
      if (sent > 0) console.log(`[lifecycle-email] sent ${sent} template(s)`);
    } catch (err) {
      Sentry.captureException(err);
      console.error('[lifecycle-email] tick failed:', err);
    } finally {
      ticking = false;
    }
  };

  loopTimer = setInterval(tick, intervalMs);
  loopTimer.unref?.();
  kickTimer = setTimeout(tick, 5_000);
  kickTimer.unref?.();
  console.log(`[lifecycle-email] enabled (every ${intervalMs}ms)`);
  return true;
}

export function stopLifecycleEmailWorker(): void {
  if (loopTimer) clearInterval(loopTimer);
  if (kickTimer) clearTimeout(kickTimer);
  loopTimer = null;
  kickTimer = null;
}
