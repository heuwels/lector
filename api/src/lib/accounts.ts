/**
 * The accounts engine (#218): Better Auth, running in-process.
 *
 * There is no external identity provider behind this — Better Auth IS the
 * auth engine (it was chosen over hosted engines like Clerk/Cognito/WorkOS,
 * see #218). It hashes passwords, mints and validates session cookies, runs
 * the OAuth dance for social providers, and issues verification/reset
 * tokens — all in this Bun process, persisting to its own tables (`user`,
 * `session`, `account`, `verification`) in the same lector.db the rest of
 * the app uses, so one Litestream stream replicates everything (#217).
 *
 * Only external touchpoints: the optional social provider (GitHub) and the
 * email transport (lib/email.ts). Nothing here runs in selfhost mode — the
 * engine is only constructed, migrated, and mounted when
 * `config.authRequired` (cloud proper). Session → userId resolution happens
 * in lib/session.ts; the identity seam routes read is lib/user.ts.
 */
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { Database } from 'bun:sqlite';
import { config } from './config';
import { sendEmail } from './email';
import { getDatabaseInstance } from '../db';

export interface AuthEngineOptions {
  database: Database;
  /** Origin the auth endpoints are reached on, e.g. https://app.lector.dev */
  baseURL: string;
  /** Session-signing secret. Boot-guarded in cloud (assertBootableMode). */
  secret: string | undefined;
  /** Browser origins allowed to hit auth endpoints cross-origin (dev UI). */
  trustedOrigins: string[];
  github?: { clientId: string; clientSecret: string };
}

/**
 * Build an isolated engine — the prod singleton and tests share this factory
 * so tests exercise the exact configuration cloud runs (in-memory DB aside).
 */
export function createAuthEngine(opts: AuthEngineOptions) {
  return betterAuth({
    database: opts.database,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await sendEmail({
            to: user.email,
            subject: 'Reset your Lector password',
            text:
              `Someone (hopefully you) asked to reset the password for ${user.email}.\n\n` +
              `Reset it here: ${url}\n\n` +
              `If this wasn't you, ignore this email — the link expires in an hour.`,
          });
        } catch (err) {
          // Don't fail the request: the user can retry from the reset form,
          // and a misconfigured transport should be loud in logs, not a 500.
          console.error(`[accounts] failed to send password reset to ${user.email}:`, err);
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        try {
          await sendEmail({
            to: user.email,
            subject: 'Verify your Lector email address',
            text:
              `Welcome to Lector. Confirm your email address to activate your account:\n\n` +
              `${url}\n\n` +
              `If you didn't sign up, ignore this email.`,
          });
        } catch (err) {
          console.error(`[accounts] failed to send verification email to ${user.email}:`, err);
        }
      },
    },
    socialProviders: opts.github ? { github: opts.github } : {},
  });
}

export type AuthEngine = ReturnType<typeof createAuthEngine>;

/**
 * Create Better Auth's tables / add missing columns, idempotently. Runs at
 * boot in cloud mode (index.ts) — same self-migrating posture as db.ts, so
 * a container update never needs a manual migration step.
 */
export async function runAuthMigrations(engine: AuthEngine): Promise<void> {
  const { runMigrations } = await getMigrations(engine.options);
  await runMigrations();
}

/**
 * Browser origins the API trusts for credentialed requests in cloud mode.
 * The canary shape is same-origin (one hostname, path-split — deploy/cloud/)
 * so this mostly matters for cross-origin dev: UI on :3456/:3000 talking to
 * the API on :3457.
 */
export function resolveTrustedOrigins(): string[] {
  const fromEnv = (process.env.LECTOR_TRUSTED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return ['http://localhost:3456', 'http://localhost:3000'];
}

function githubFromEnv(): AuthEngineOptions['github'] {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

let _engine: AuthEngine | null = null;

/** The prod engine, lazily built from env — never called in selfhost mode. */
export function getAuthEngine(): AuthEngine {
  if (_engine) return _engine;
  const port = process.env.PORT || '3457';
  _engine = createAuthEngine({
    database: getDatabaseInstance(),
    baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${port}`,
    secret: config.authSecret,
    trustedOrigins: resolveTrustedOrigins(),
    github: githubFromEnv(),
  });
  return _engine;
}
