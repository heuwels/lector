/**
 * Better Auth engine (#218): accounts, sessions, email verification, and
 * password reset, run in-process. Its tables (`user`, `session`, `account`,
 * `verification`) live in the same lector.db as user data so a single
 * replication stream covers both (#217). Only constructed, migrated, and
 * mounted in cloud proper (`config.authRequired`) — selfhost never touches
 * it. Session → userId: lib/session.ts; route-side reads: lib/user.ts.
 */
import { betterAuth } from 'better-auth';
import { captcha } from 'better-auth/plugins';
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
  /**
   * Cloudflare Turnstile secret. When set, sign-up, sign-in, and
   * password-reset requests must carry an `x-captcha-response` token
   * (the plugin fails closed on a missing/invalid one). The matching site
   * key reaches the browser via window.__ENV__ (docker-entrypoint.sh).
   */
  turnstileSecretKey?: string;
}

/** Factory shared by the prod singleton and tests (in-memory DB aside). */
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
          // A transport failure must be loud in logs, not a 500 on the flow.
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
    plugins: opts.turnstileSecretKey
      ? [captcha({ provider: 'cloudflare-turnstile', secretKey: opts.turnstileSecretKey })]
      : [],
  });
}

export type AuthEngine = ReturnType<typeof createAuthEngine>;

/**
 * Create/extend Better Auth's tables, idempotently. Runs at boot in cloud
 * mode (index.ts) — same self-migrating posture as db.ts.
 */
export async function runAuthMigrations(engine: AuthEngine): Promise<void> {
  const { runMigrations } = await getMigrations(engine.options);
  await runMigrations();
}

/**
 * Browser origins trusted for credentialed requests in cloud mode. Prod is
 * same-origin path-split (deploy/cloud/), so this mostly serves cross-origin
 * dev: UI on :3456/:3000 → API on :3457.
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
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || undefined,
  });
  return _engine;
}
