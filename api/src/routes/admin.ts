/**
 * Admin dashboard API (#221) — operator-only visibility + support actions.
 * Mounted at /api/admin behind `requireAdmin` (index.ts), so every handler
 * here can assume the caller is an admin in cloud proper.
 *
 * Scope of this first cut (issue #221):
 *   - user list + per-user detail: signup, plan, status, last-active,
 *     library size, storage, this-month usage,
 *   - aggregate summary (accounts, subscriptions by plan/status, month usage),
 *   - support actions: export a user's data, suspend / restore an account.
 * Deliberately deferred (need other workstreams): plan overrides / comp
 * (the entitlements engine #222 must consult them to mean anything) and the
 * aggregate $-cost dashboard (per-call cost coefficients are #226). Usage
 * counts are shown now; cost conversion lands with W9.
 */
import { Hono } from 'hono';
import { db } from '../db';
import {
  makeRequireAdmin,
  setSuspended,
  suspendedMap,
  isAdmin,
  adminConfig,
  type AdminGateOptions,
} from '../lib/admin';
import { billingConfig } from '../lib/billing';
import { buildUserExport } from '../lib/user-export';

// The plan a priceId maps to, from billing config — kept local so this route
// does not depend on the entitlements engine (#222), which may or may not be
// merged. An entitled subscription whose price we can't map is still a paying
// account; label it 'cloud' (the base plan).
function priceToPlan(priceId: string | null): 'cloud' | 'plus' | null {
  if (!priceId) return null;
  return billingConfig.prices.find((p) => p.id === priceId)?.plan ?? null;
}

const ENTITLED = new Set(['active', 'trialing', 'past_due']);
const STATUS_RANK = ['active', 'trialing', 'past_due', 'paused', 'canceled'];

interface AuthUserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: number | null;
  createdAt: string | null;
}

interface SubRow {
  userId: string | null;
  paddleCustomerId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: string | null;
  occurredAt: string;
}

/** Best subscription for an account (by tenant id or by customer email), or null. */
function resolveSub(
  user: AuthUserRow,
  subsByUser: Map<string, SubRow[]>,
  subsByCustomer: Map<string, SubRow[]>,
  customerIdsByEmail: Map<string, string[]>,
): SubRow | null {
  const candidates: SubRow[] = [...(subsByUser.get(user.id) ?? [])];
  for (const cid of customerIdsByEmail.get(user.email.toLowerCase()) ?? []) {
    candidates.push(...(subsByCustomer.get(cid) ?? []));
  }
  let best: SubRow | null = null;
  for (const s of candidates) {
    if (!best) {
      best = s;
      continue;
    }
    const r = STATUS_RANK.indexOf(s.status);
    const br = STATUS_RANK.indexOf(best.status);
    if (r !== -1 && (br === -1 || r < br || (r === br && s.occurredAt > best.occurredAt))) best = s;
  }
  return best;
}

/** Does the usage_counters table exist? It's created by the entitlements
 * engine (#222); this dashboard degrades gracefully to zero usage when that
 * has not been deployed yet, in either merge order. */
function hasUsageCounters(): boolean {
  // bun:sqlite .get() returns null (not undefined) for no rows — test
  // truthiness, not `!== undefined`, or an absent table reads as present.
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_counters'")
      .get(),
  );
}

/** This-month usage per user for a metric, keyed by userId (empty if #222 absent). */
function usageForMonth(metric: string, period: string): Map<string, number> {
  if (!hasUsageCounters()) return new Map();
  const rows = db
    .prepare('SELECT userId, value FROM usage_counters WHERE metric = ? AND period = ?')
    .all(metric, period) as { userId: string; value: number }[];
  return new Map(rows.map((r) => [r.userId, r.value]));
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function countBy(table: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT userId, COUNT(*) AS n FROM ${table} GROUP BY userId`)
    .all() as { userId: string; n: number }[];
  return new Map(rows.map((r) => [r.userId, r.n]));
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function makeAdminRoutes(gate: AdminGateOptions = adminConfig) {
  const app = new Hono();

  app.use('*', makeRequireAdmin(gate));

  // Shared assembly: every account with its plan/status/usage/library facts.
  function buildUserRows() {
    const users = db
      .prepare('SELECT id, email, name, emailVerified, createdAt FROM user')
      .all() as AuthUserRow[];

    const subs = db
      .prepare(
        'SELECT userId, paddleCustomerId, status, priceId, currentPeriodEnd, occurredAt FROM billing_subscriptions',
      )
      .all() as SubRow[];
    const subsByUser = new Map<string, SubRow[]>();
    const subsByCustomer = new Map<string, SubRow[]>();
    for (const s of subs) {
      if (s.userId) pushInto(subsByUser, s.userId, s);
      pushInto(subsByCustomer, s.paddleCustomerId, s);
    }
    const customers = db
      .prepare('SELECT paddleCustomerId, email FROM billing_customers')
      .all() as { paddleCustomerId: string; email: string }[];
    const customerIdsByEmail = new Map<string, string[]>();
    for (const cust of customers) {
      pushInto(customerIdsByEmail, cust.email.toLowerCase(), cust.paddleCustomerId);
    }

    const collections = countBy('collections');
    const lessons = countBy('lessons');
    const vocab = countBy('vocab');
    const knownWords = countBy('knownWords');

    // Storage proxy: bytes of stored lesson text per user (the dominant
    // user-owned payload; dictionaries/banks are shared, not counted).
    const storage = new Map<string, number>(
      (
        db
          .prepare('SELECT userId, COALESCE(SUM(LENGTH(textContent)), 0) AS bytes FROM lessons GROUP BY userId')
          .all() as { userId: string; bytes: number }[]
      ).map((r) => [r.userId, r.bytes]),
    );

    // Last active: most recent Better Auth session touch, else latest daily
    // stat day. Sessions are the truer "seen recently" signal.
    const lastSession = new Map<string, string>(
      (
        db
          .prepare('SELECT userId, MAX(updatedAt) AS t FROM session GROUP BY userId')
          .all() as { userId: string; t: string | null }[]
      )
        .filter((r) => r.t)
        .map((r) => [r.userId, r.t as string]),
    );
    const lastStat = new Map<string, string>(
      (
        db
          .prepare('SELECT userId, MAX(date) AS d FROM dailyStats GROUP BY userId')
          .all() as { userId: string; d: string | null }[]
      )
        .filter((r) => r.d)
        .map((r) => [r.userId, r.d as string]),
    );

    const period = currentPeriod();
    const llm = usageForMonth('llmRequestsPerMonth', period);
    const tts = usageForMonth('ttsCharsPerMonth', period);
    const journalWords = usageForMonth('journalWordsPerMonth', period);
    const suspended = suspendedMap();

    return users.map((u) => {
      const sub = resolveSub(u, subsByUser, subsByCustomer, customerIdsByEmail);
      const entitled = sub !== null && ENTITLED.has(sub.status);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: u.emailVerified === 1,
        createdAt: u.createdAt,
        plan: entitled ? (priceToPlan(sub!.priceId) ?? 'cloud') : null,
        status: sub?.status ?? 'none',
        entitled,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        suspended: suspended.has(u.id),
        suspendedReason: suspended.get(u.id) ?? null,
        lastActiveAt: lastSession.get(u.id) ?? lastStat.get(u.id) ?? null,
        library: {
          collections: collections.get(u.id) ?? 0,
          lessons: lessons.get(u.id) ?? 0,
          vocab: vocab.get(u.id) ?? 0,
          knownWords: knownWords.get(u.id) ?? 0,
          storageBytes: storage.get(u.id) ?? 0,
        },
        usage: {
          period,
          llmRequests: llm.get(u.id) ?? 0,
          ttsChars: tts.get(u.id) ?? 0,
          journalWords: journalWords.get(u.id) ?? 0,
          tracked: hasUsageCounters(),
        },
      };
    });
  }

  // GET /api/admin/access — cheap yes/no the client nav probes to decide
  // whether to render the Admin link. Reachable by any authed account (it's
  // behind requireAdmin, so a non-admin already got 403 before here) — 200
  // means "you are an admin".
  app.get('/access', (c) => c.json({ admin: true }));

  // GET /api/admin/summary — service-wide aggregates.
  app.get('/summary', (c) => {
    const rows = buildUserRows();
    const byPlan: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let subscribers = 0;
    let verified = 0;
    let suspended = 0;
    const usageTotals = { llmRequests: 0, ttsChars: 0, journalWords: 0 };
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.entitled) {
        subscribers++;
        byPlan[r.plan ?? 'cloud'] = (byPlan[r.plan ?? 'cloud'] ?? 0) + 1;
      }
      if (r.emailVerified) verified++;
      if (r.suspended) suspended++;
      usageTotals.llmRequests += r.usage.llmRequests;
      usageTotals.ttsChars += r.usage.ttsChars;
      usageTotals.journalWords += r.usage.journalWords;
    }
    return c.json({
      users: rows.length,
      verified,
      subscribers,
      suspended,
      byPlan,
      byStatus,
      period: currentPeriod(),
      usageTotals,
      usageTracked: hasUsageCounters(),
    });
  });

  // GET /api/admin/users — every account, richest → sortable client-side.
  app.get('/users', (c) => c.json({ users: buildUserRows() }));

  // GET /api/admin/users/:id — one account (same shape as a list row).
  app.get('/users/:id', (c) => {
    const row = buildUserRows().find((r) => r.id === c.req.param('id'));
    if (!row) return c.json({ error: 'User not found' }, 404);
    return c.json(row);
  });

  // GET /api/admin/users/:id/export — operator-triggered data takeout for a
  // user (support action). Same builder as self-service GET /api/data.
  app.get('/users/:id/export', (c) => {
    const id = c.req.param('id');
    const exists = db.prepare('SELECT 1 FROM user WHERE id = ?').get(id);
    if (!exists) return c.json({ error: 'User not found' }, 404);
    return c.json(buildUserExport(id));
  });

  // POST /api/admin/users/:id/suspend { reason? } — lock an abuser. Guarded
  // against self-suspension (an admin can't lock themselves out).
  app.post('/users/:id/suspend', async (c) => {
    const id = c.req.param('id');
    const exists = db.prepare('SELECT 1 FROM user WHERE id = ?').get(id);
    if (!exists) return c.json({ error: 'User not found' }, 404);

    const caller = c.get('userId');
    if (id === caller) return c.json({ error: 'You cannot suspend your own account' }, 400);
    // Also refuse to suspend another admin — operators don't lock each other out.
    if (isAdmin(id, gate)) {
      return c.json({ error: 'Cannot suspend an admin account' }, 400);
    }

    let reason: string | null = null;
    try {
      const body = (await c.req.json()) as { reason?: unknown };
      if (typeof body.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
    } catch {
      /* no body is fine */
    }
    setSuspended(id, true, reason);
    return c.json({ id, suspended: true, reason });
  });

  // POST /api/admin/users/:id/restore — lift a suspension.
  app.post('/users/:id/restore', (c) => {
    const id = c.req.param('id');
    const exists = db.prepare('SELECT 1 FROM user WHERE id = ?').get(id);
    if (!exists) return c.json({ error: 'User not found' }, 404);
    setSuspended(id, false, null);
    return c.json({ id, suspended: false });
  });

  return app;
}

export default makeAdminRoutes();
