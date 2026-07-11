/**
 * Local → cloud ownership migration (self-host operator tool).
 *
 * Selfhost stamps every user-data row with the implicit userId 'local'
 * (LOCAL_USER_ID, lib/user.ts). Switching a box to cloud mode (LECTOR_MODE=
 * cloud) turns on Better Auth and per-user scoping: you log in — via OIDC,
 * GitHub, or email/password — and get a fresh UUID user id, at which point
 * every query scopes `WHERE userId = '<uuid>'` and the whole 'local' history
 * goes invisible. Nothing in the boot path reassigns it — migrateAddUserIdColumn
 * (db.ts) hard-defaults new rows to 'local' and never moves them — so a
 * single-user self-hoster adopting cloud mode needs a one-time reassignment.
 * This is that reassignment.
 *
 * Driven by scripts/adopt-local-data.ts, a manual operator command (dry-run by
 * default). Deliberately NOT wired into boot: it's a one-time transition, the
 * target user only exists after the first login, and moving someone's entire
 * learning history should be an explicit, audited step — never a silent boot
 * side effect.
 */
import type { Database } from 'bun:sqlite';
import { LOCAL_USER_ID } from './user';
import { BYOK_PROVIDERS, decryptCredential, encryptCredential } from './byok';

/**
 * Every table whose rows belong to a tenant (carry `userId`). Exactly the set
 * migrateAddUserIdColumn (db.ts) stamps: the plain-ALTER tables plus the three
 * whose PRIMARY KEY gained userId (knownWords / dailyStats / settings).
 * Global / read-only data (cached_entries|senses|related_forms, billing_*, the
 * bundled dictionaries) and Better Auth's own tables (user / session / account
 * / verification) are not tenant-owned and stay put.
 *
 * A ratchet test (adopt-local-data.test.ts) asserts this equals every table
 * carrying a userId column in a freshly migrated DB, so a future tenant table
 * cannot silently escape adoption.
 */
export const TENANT_TABLES = [
  'collections',
  'lessons',
  'vocab',
  'clozeSentences',
  'journal_entries',
  'chat_messages',
  'collection_groups',
  'api_tokens',
  'knownWords',
  'dailyStats',
  'settings',
  // Guided onboarding profile/progress and the learner activity stream (#331)
  // are first-class learning history, so they move with the library.
  'learner_profiles',
  'onboarding_progress',
  'learner_events',
  // BYOK credentials are not part of user-facing exports, but they are still
  // tenant-owned rows and must follow an explicit selfhost→cloud adoption.
  'user_provider_credentials',
  // Plan-limit usage counters (#222): adopted so a migrating self-hoster's
  // current-month metering carries over instead of resetting to zero.
  'usage_counters',
  // Anki export queue (#241): adopted so cards queued before the switch still
  // reach the addon afterwards (rows join vocab on the same userId).
  'anki_pending',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];
export type RowCounts = Record<TenantTable, number>;

export interface AdoptReport {
  targetUserId: string;
  dryRun: boolean;
  /** Rows owned by 'local' per table — what moved (or would move on --commit). */
  moved: RowCounts;
  totalMoved: number;
}

/** Thrown when the target account already owns rows: adoption is fresh-only. */
export class AdoptConflictError extends Error {
  constructor(
    readonly targetUserId: string,
    readonly conflicts: Partial<RowCounts>,
  ) {
    const detail = Object.entries(conflicts)
      .map(([table, n]) => `${table}=${n}`)
      .join(', ');
    super(
      `Refusing to adopt local data into ${targetUserId}: that account already owns ` +
        `rows (${detail}). adopt-local-data migrates only into a fresh account, so it ` +
        `can never merge two users' data or collide on a primary key. Adopt into a ` +
        `newly-created user, or resolve the existing rows first.`,
    );
    this.name = 'AdoptConflictError';
  }
}

/** Count rows owned by `userId` across every tenant table. */
export function countRowsByUser(db: Database, userId: string): RowCounts {
  const counts = {} as RowCounts;
  for (const table of TENANT_TABLES) {
    // `table` is a fixed literal from TENANT_TABLES, never caller input — safe
    // to interpolate (bun:sqlite cannot bind an identifier).
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE userId = ?`).get(userId) as {
      n: number;
    };
    counts[table] = row.n;
  }
  return counts;
}

export interface AdoptOptions {
  /** Report what would move without writing anything. Default false. */
  dryRun?: boolean;
}

/**
 * Reassign every row owned by 'local' to `targetUserId`, atomically. Refuses
 * (AdoptConflictError) if the target already owns any tenant row, so it only
 * ever adopts a self-host history into a fresh cloud account. Idempotent: once
 * run, no 'local' rows remain, so a re-run reports (and moves) nothing.
 */
export function adoptLocalData(
  db: Database,
  targetUserId: string,
  options: AdoptOptions = {},
): AdoptReport {
  const dryRun = options.dryRun ?? false;
  if (!targetUserId || targetUserId === LOCAL_USER_ID) {
    throw new Error(
      `Invalid adoption target ${JSON.stringify(targetUserId)}: must be a real user id, ` +
        `not empty and not '${LOCAL_USER_ID}'.`,
    );
  }

  // Guard + reassignment share one closure so a --commit run does them in a
  // single transaction (WAL lets the app keep writing concurrently). Throwing
  // the conflict inside the transaction rolls it back untouched.
  const apply = (): RowCounts => {
    const moved = countRowsByUser(db, LOCAL_USER_ID);
    const totalLocal = Object.values(moved).reduce((sum, n) => sum + n, 0);
    // Nothing owned by 'local' → clean no-op, regardless of what the target
    // owns. Keeps a re-run (or a fresh cloud box that never had local data)
    // idempotent instead of throwing a spurious conflict; the fresh-account
    // guard below only matters when there is actually data to move.
    if (totalLocal === 0) return moved;

    const targetCounts = countRowsByUser(db, targetUserId);
    const conflicts = Object.fromEntries(
      Object.entries(targetCounts).filter(([, n]) => n > 0),
    ) as Partial<RowCounts>;
    if (Object.keys(conflicts).length > 0) {
      throw new AdoptConflictError(targetUserId, conflicts);
    }

    if (!dryRun) {
      for (const table of TENANT_TABLES) {
        if (table === 'user_provider_credentials') {
          // The AES-GCM additional authenticated data includes userId to stop
          // ciphertext being swapped between tenants. Re-encrypt while the
          // explicit adoption changes ownership, rather than merely updating
          // the bound identifier and leaving an undecryptable credential.
          const credentials = db
            .prepare('SELECT provider, ciphertext FROM user_provider_credentials WHERE userId = ?')
            .all(LOCAL_USER_ID) as Array<{ provider: string; ciphertext: string }>;
          for (const credential of credentials) {
            if (!BYOK_PROVIDERS.includes(credential.provider as (typeof BYOK_PROVIDERS)[number]))
              continue;
            let secret: string;
            try {
              secret = decryptCredential(LOCAL_USER_ID, credential.provider, credential.ciphertext);
            } catch {
              // A stale credential must not block adoption of the user's entire
              // library. Drop it; the user can safely re-enter it after login.
              console.warn(
                `[adopt-local-data] skipped unreadable ${credential.provider} BYOK credential`,
              );
              db.prepare(
                'DELETE FROM user_provider_credentials WHERE userId = ? AND provider = ?',
              ).run(LOCAL_USER_ID, credential.provider);
              continue;
            }
            const ciphertext = encryptCredential(targetUserId, credential.provider, secret);
            db.prepare(
              'UPDATE user_provider_credentials SET userId = ?, ciphertext = ? WHERE userId = ? AND provider = ?',
            ).run(targetUserId, ciphertext, LOCAL_USER_ID, credential.provider);
          }
          continue;
        }
        db.prepare(`UPDATE ${table} SET userId = ? WHERE userId = ?`).run(
          targetUserId,
          LOCAL_USER_ID,
        );
      }
    }
    return moved;
  };

  const moved = dryRun ? apply() : db.transaction(apply)();
  const totalMoved = Object.values(moved).reduce((sum, n) => sum + n, 0);
  return { targetUserId, dryRun, moved, totalMoved };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

/** True once this DB has run cloud mode (Better Auth created its `user` table). */
export function hasAuthTables(db: Database): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").get();
  return row != null;
}

/** Every registered user, oldest first. Empty if the DB never ran cloud mode. */
export function listAuthUsers(db: Database): AuthUser[] {
  if (!hasAuthTables(db)) return [];
  // `user` is a reserved word — must be quoted. Order by rowid (insertion
  // order) so we don't depend on a particular Better Auth timestamp column.
  return db.prepare('SELECT id, email, name FROM "user" ORDER BY rowid').all() as AuthUser[];
}

/** Resolve a registered user by email (case-insensitive). */
export function resolveUserByEmail(db: Database, email: string): AuthUser | undefined {
  if (!hasAuthTables(db)) return undefined;
  // bun:sqlite's .get() returns null (not undefined) on no match — normalize.
  const row = db
    .prepare('SELECT id, email, name FROM "user" WHERE email = ? COLLATE NOCASE')
    .get(email) as AuthUser | null;
  return row ?? undefined;
}
