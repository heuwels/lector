/**
 * Client half of the billing gate (#224). The Hono API owns all state
 * (api/src/lib/billing.ts — the Paddle webhook mirror); this module just
 * fetches /api/billing/status, which BillingGuard gates the app on and the
 * /subscribe page renders checkout from.
 */
import { apiFetch } from './api-base';

export interface BillingPrice {
  /** Paddle price id (pri_…). */
  id: string;
  plan: 'cloud' | 'plus';
  cycle: 'month' | 'year';
}

export interface BillingCheckout {
  clientToken: string | null;
  environment: 'production' | 'sandbox';
  prices: BillingPrice[];
  email: string | null;
  userId: string;
}

export type BillingStatus =
  | { enforced: false; active: true }
  | {
      enforced: true;
      active: boolean;
      exempt: boolean;
      status: string;
      checkout: BillingCheckout;
    };

/**
 * Null on any failure. Callers treat that as "don't lock": enforcement lives
 * server-side (every gated call 402s regardless), so the only effect of
 * failing open here is skipping a redundant client-side screen while the API
 * is unreachable.
 */
export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  try {
    const res = await apiFetch('/api/billing/status');
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}
