/**
 * Deployment mode (#242): one codebase, mode-flagged.
 *
 * `LECTOR_MODE` selects the deployment shape at *runtime* (it rides the same
 * runtime-config rail as `API_URL` — see docker-entrypoint.sh):
 *
 *   - `selfhost` (default, and the behavior of every deployment to date):
 *     single implicit user, no login, API trusts local access.
 *   - `cloud`: the future managed offering (#216) — real accounts, per-request
 *     auth, per-user data isolation. **Fail-closed until that ships**: cloud
 *     mode refuses to boot (see `assertBootableMode`) so no instance can claim
 *     tenant isolation the code does not provide yet (#218).
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
 * Boot-path guard: cloud mode is fail-closed until accounts & per-user auth
 * land (#218). Today's API treats requests without an Authorization header as
 * trusted local access — booting that under a "cloud" flag would be an
 * unauthenticated instance claiming to be multi-tenant. Refuse instead.
 *
 * The single exception is the canary shape: `LECTOR_CLOUD_GATE=external`
 * asserts an external gateway (e.g. Cloudflare Access) authenticates every
 * request before it reaches the app, so booting fail-open behind it is a
 * deliberate, named decision rather than an accident.
 *
 * Throws (rather than exiting) so callers own the exit; the server entry
 * (src/index.ts) catches, logs FATAL, and exits non-zero. docker-entrypoint.sh
 * enforces the same rule before either server starts.
 */
export function assertBootableMode(mode: LectorMode, gate: CloudGate): void {
  if (mode === 'cloud' && gate !== 'external') {
    throw new Error(
      'LECTOR_MODE=cloud is not available yet: cloud mode requires accounts & per-user ' +
        'auth, which have not shipped (heuwels/lector#218 — tracked under #242). ' +
        'Unset LECTOR_MODE (or set it to "selfhost") to run the self-hosted app. ' +
        'If an external gateway (e.g. Cloudflare Access) authenticates EVERY request ' +
        'before it reaches this app, set LECTOR_CLOUD_GATE=external to run the cloud canary.',
    );
  }
}

/**
 * Resolved deployment config — the switch everything mode-specific reads.
 * `authRequired` means "the app itself must authenticate requests": false in
 * selfhost (trusted network) and false under an external gate (the gateway
 * authenticates); it becomes true for cloud proper when #218 ships.
 */
export const config: {
  readonly mode: LectorMode;
  readonly cloudGate: CloudGate;
  readonly authRequired: boolean;
} = (() => {
  const mode = parseLectorMode(process.env.LECTOR_MODE);
  const cloudGate = parseCloudGate(process.env.LECTOR_CLOUD_GATE);
  return { mode, cloudGate, authRequired: mode === 'cloud' && cloudGate === 'none' } as const;
})();
