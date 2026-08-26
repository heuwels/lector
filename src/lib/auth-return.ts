/**
 * The only pre-auth destination Lector preserves is the paid-plan picker.
 * Keeping this allowlist narrow means `next` can never become an open redirect,
 * while marketing links can still carry a Cloud or Cloud Plus choice — and a
 * campaign code word (#516) — through registration, verification, sign-in, and
 * two-factor authentication.
 *
 * Two parameters are allowed, `plan` and `promo`, and both are rebuilt from
 * validated values rather than passed through. The path stays pinned to
 * /subscribe, so widening the parameter allowlist adds no redirect surface.
 */

export type PaidPlan = 'cloud' | 'plus';

const SUBSCRIBE_PATH = '/subscribe';
const SAFE_ORIGIN = 'https://app.lector.invalid';
const ALLOWED_PARAMS = new Set(['plan', 'promo']);

/**
 * Paddle's grammar for a redeemable code: letters and numbers, 32 maximum.
 * api/src/lib/billing.ts holds the authoritative copy and is the only place
 * that maps a code to a discount. This one exists so a junk value never
 * survives into a stored `next` destination.
 */
const PROMO_PATTERN = /^[A-Z0-9]{1,32}$/;

function isPaidPlan(value: string | null): value is PaidPlan {
  return value === 'cloud' || value === 'plus';
}

/** A code word normalised for a URL, or null when it could never be one. */
function normalizePromo(value: string | null): string | null {
  if (value === null) return null;
  const promo = value.trim().toUpperCase();
  return PROMO_PATTERN.test(promo) ? promo : null;
}

/** Return a canonical, internal subscribe path or reject the destination. */
export function sanitizeAuthReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(value, SAFE_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== SAFE_ORIGIN || url.pathname !== SUBSCRIBE_PATH || url.hash !== '') {
    return null;
  }

  const params = url.searchParams;
  // An unrecognised parameter, or a repeated one, rejects the whole
  // destination. Silently dropping it would let a crafted link look preserved
  // while it quietly lost the reader's coupon.
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return null;
    if (params.getAll(key).length > 1) return null;
  }

  const plan = params.get('plan');
  if (plan !== null && !isPaidPlan(plan)) return null;

  const rawPromo = params.get('promo');
  const promo = normalizePromo(rawPromo);
  if (rawPromo !== null && promo === null) return null;

  const canonical = new URLSearchParams();
  if (plan !== null) canonical.set('plan', plan);
  if (promo !== null) canonical.set('promo', promo);
  const query = canonical.toString();

  return query === '' ? SUBSCRIBE_PATH : `${SUBSCRIBE_PATH}?${query}`;
}

/** Read and validate `next` from an auth page's query string. */
export function authReturnPathFromSearch(search: string): string | null {
  return sanitizeAuthReturnPath(new URLSearchParams(search).get('next'));
}

/** Add a validated return destination to an auth route. */
export function authHref(route: string, returnPath: string | null | undefined): string {
  const safeReturnPath = sanitizeAuthReturnPath(returnPath);
  if (!safeReturnPath) return route;
  return `${route}?${new URLSearchParams({ next: safeReturnPath }).toString()}`;
}

/** Read a paid-plan selection on /subscribe. */
export function paidPlanFromSearch(search: string): PaidPlan | null {
  const plan = new URLSearchParams(search).get('plan');
  return isPaidPlan(plan) ? plan : null;
}

/**
 * Read a campaign code word on /subscribe. Normalised, so a link written in
 * lower case still resolves. The API decides whether it maps to a discount.
 */
export function promoFromSearch(search: string): string | null {
  return normalizePromo(new URLSearchParams(search).get('promo'));
}
