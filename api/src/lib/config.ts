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
 * Read once at import into the `config` singleton; everything mode-specific
 * branches on `config.mode` / `config.authRequired` rather than re-reading env.
 */

export type LectorMode = 'selfhost' | 'cloud';

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
 * Boot-path guard: cloud mode is fail-closed until accounts & per-user auth
 * land (#218). Today's API treats requests without an Authorization header as
 * trusted local access — booting that under a "cloud" flag would be an
 * unauthenticated instance claiming to be multi-tenant. Refuse instead.
 *
 * Throws (rather than exiting) so callers own the exit; the server entry
 * (src/index.ts) catches, logs FATAL, and exits non-zero. docker-entrypoint.sh
 * enforces the same rule before either server starts.
 */
export function assertBootableMode(mode: LectorMode): void {
  if (mode === 'cloud') {
    throw new Error(
      'LECTOR_MODE=cloud is not available yet: cloud mode requires accounts & per-user ' +
        'auth, which have not shipped (heuwels/lector#218 — tracked under #242). ' +
        'Unset LECTOR_MODE (or set it to "selfhost") to run the self-hosted app.',
    );
  }
}

/** Resolved deployment config — the switch everything mode-specific reads. */
export const config: { readonly mode: LectorMode; readonly authRequired: boolean } = (() => {
  const mode = parseLectorMode(process.env.LECTOR_MODE);
  return { mode, authRequired: mode === 'cloud' } as const;
})();
