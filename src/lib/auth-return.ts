/**
 * The only pre-auth destination Lector preserves is the paid-plan picker.
 * Keeping this allowlist narrow means `next` can never become an open redirect,
 * while marketing links can still carry a Cloud or Cloud Plus choice through
 * registration, verification, sign-in, and two-factor authentication.
 */

export type PaidPlan = 'cloud' | 'plus';

const SUBSCRIBE_PATH = '/subscribe';
const SAFE_ORIGIN = 'https://app.lector.invalid';

function isPaidPlan(value: string | null): value is PaidPlan {
  return value === 'cloud' || value === 'plus';
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

  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return SUBSCRIBE_PATH;
  if (entries.length !== 1 || entries[0][0] !== 'plan' || !isPaidPlan(entries[0][1])) {
    return null;
  }

  return `${SUBSCRIBE_PATH}?plan=${entries[0][1]}`;
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
