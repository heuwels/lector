/**
 * Deployment mode (#242): one codebase, mode-flagged.
 *
 * `LECTOR_MODE` selects the deployment shape at *runtime* (it rides the same
 * runtime-config rail as `API_URL` — see docker-entrypoint.sh):
 *
 *   - `selfhost` (default, and the behavior of every deployment to date):
 *     single implicit user, no login, API trusts local access.
 *   - `cloud`: the managed offering (#216) — built-in accounts & sessions
 *     (Better Auth, #218), per-request auth, per-user data isolation.
 *     **Fail-closed on misconfiguration**: cloud proper refuses to boot
 *     without `BETTER_AUTH_SECRET` (see `assertBootableMode`) so no instance
 *     ever signs sessions with a default secret.
 *
 * `LECTOR_CLOUD_GATE` is the one sanctioned exception, for the cloud *canary*:
 * `external` declares that an authenticating gateway (Cloudflare Access, a VPN,
 * an SSO proxy) fronts EVERY request before it reaches this app, so app-level
 * auth is deliberately delegated. cloud+external boots — still as a single
 * implicit user (per-user isolation lands with #217/#218) — and lets the cloud
 * code paths run in production before built-in accounts exist. It is ignored
 * in selfhost mode.
 *
 * Read once at import into the `config` singleton; everything mode-specific
 * branches on `config.mode` / `config.authRequired` rather than re-reading env.
 */

export type LectorMode = 'selfhost' | 'cloud';
export type CloudGate = 'none' | 'external';
export type TrustedProxy = 'none' | 'cloudflare';

const VALID_MODES: readonly LectorMode[] = ['selfhost', 'cloud'];

/**
 * Parse a raw LECTOR_MODE env value. Unset or empty → 'selfhost' (the
 * back-compat default: existing deployments set nothing and must behave
 * exactly as before). Anything else must match a known mode exactly —
 * a typo silently degrading to selfhost would be a fail-open footgun.
 */
export function parseLectorMode(raw: string | undefined): LectorMode {
  const value = (raw ?? '').trim();
  if (value === '') return 'selfhost';
  if ((VALID_MODES as readonly string[]).includes(value)) return value as LectorMode;
  throw new Error(
    `Invalid LECTOR_MODE "${value}" — expected one of: ${VALID_MODES.join(', ')} ` +
      '(unset defaults to selfhost).',
  );
}

/**
 * Parse a raw LECTOR_CLOUD_GATE env value. Unset/empty → 'none'. Only
 * 'external' is recognized; anything else throws for the same reason modes
 * do — a typo must never silently weaken the boot guard.
 */
export function parseCloudGate(raw: string | undefined): CloudGate {
  const value = (raw ?? '').trim();
  if (value === '') return 'none';
  if (value === 'external') return 'external';
  throw new Error(
    `Invalid LECTOR_CLOUD_GATE "${value}" — expected "external" (or unset). ` +
      'Set it only when an authenticating gateway fronts every request.',
  );
}

/**
 * Client IP headers are authoritative only when the origin topology makes
 * them so. Cloudflare Tunnel is the one supported trusted-proxy shape today;
 * unset means no forwarded client-IP header is consumed.
 */
export function parseTrustedProxy(raw: string | undefined): TrustedProxy {
  const value = (raw ?? '').trim();
  if (value === '') return 'none';
  if (value === 'cloudflare') return 'cloudflare';
  throw new Error(`Invalid LECTOR_TRUSTED_PROXY "${value}" — expected "cloudflare" (or unset).`);
}

/** Mirror docker-entrypoint.sh's `${NODE_ENV:-production}` default. */
export function isProductionEnvironment(raw: string | undefined): boolean {
  return (raw || 'production') === 'production';
}

/**
 * Boot-path guard. Cloud proper (no external gate) runs built-in accounts &
 * sessions (#218), and Better Auth falls back to a well-known default secret
 * when none is configured — booting that in production would mean forgeable
 * session cookies. Refuse instead: cloud without `LECTOR_CLOUD_GATE=external`
 * requires `BETTER_AUTH_SECRET`.
 *
 * The canary shape is unchanged: `LECTOR_CLOUD_GATE=external` asserts an
 * external gateway (e.g. Cloudflare Access) authenticates every request
 * before it reaches the app, so it boots without built-in auth (and without
 * a secret) as a deliberate, named decision.
 *
 * Throws (rather than exiting) so callers own the exit; the server entry
 * (src/index.ts) catches, logs FATAL, and exits non-zero. docker-entrypoint.sh
 * enforces the same rule before either server starts.
 */
export function assertBootableMode(
  mode: LectorMode,
  gate: CloudGate,
  hasAuthSecret: boolean,
): void {
  if (mode === 'cloud' && gate !== 'external' && !hasAuthSecret) {
    throw new Error(
      'LECTOR_MODE=cloud requires BETTER_AUTH_SECRET: cloud mode runs built-in accounts ' +
        '& sessions (heuwels/lector#218) and must never sign them with a default secret. ' +
        'Generate one (e.g. `openssl rand -base64 32`) and set BETTER_AUTH_SECRET, or set ' +
        'LECTOR_CLOUD_GATE=external if an authenticating gateway fronts EVERY request. ' +
        'Unset LECTOR_MODE (or set it to "selfhost") to run the self-hosted app.',
    );
  }
}

/**
 * Resolved deployment config — the switch everything mode-specific reads.
 * `authRequired` means "the app itself must authenticate requests": false in
 * selfhost (trusted network) and false under an external gate (the gateway
 * authenticates); true for cloud proper, where Better Auth sessions are the
 * credential (#218). `authSecret` is Better Auth's session-signing secret —
 * presence is boot-guarded for cloud proper. `trustedProxy` is the explicit
 * origin-topology assertion used before consuming any forwarded client IP.
 */
export const config: {
  readonly mode: LectorMode;
  readonly cloudGate: CloudGate;
  readonly trustedProxy: TrustedProxy;
  readonly authRequired: boolean;
  readonly authSecret: string | undefined;
} = (() => {
  const mode = parseLectorMode(process.env.LECTOR_MODE);
  const cloudGate = parseCloudGate(process.env.LECTOR_CLOUD_GATE);
  const trustedProxy = parseTrustedProxy(process.env.LECTOR_TRUSTED_PROXY);
  const authSecret = process.env.BETTER_AUTH_SECRET || undefined;
  return {
    mode,
    cloudGate,
    trustedProxy,
    authRequired: mode === 'cloud' && cloudGate === 'none',
    authSecret,
  } as const;
})();
