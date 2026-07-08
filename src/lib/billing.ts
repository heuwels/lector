/**
 * Client half of the billing gate (#224). The Hono API owns all state
 * (api/src/lib/billing.ts — the Paddle webhook mirror); this module fetches
 * /api/billing/status (which BillingGuard gates the app on and the /subscribe
 * screen renders its tiers from) and starts checkout, which the API creates as
 * a Paddle transaction so the overlay can open on the approved lector.dev
 * domain.
 */
import { apiFetch } from './api-base';

export interface BillingPrice {
  /** Paddle price id (pri_…). */
  id: string;
  plan: 'cloud' | 'plus';
  cycle: 'month' | 'year';
}

export interface BillingCheckout {
  prices: BillingPrice[];
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

/**
 * Create a Paddle checkout transaction for `priceId` and return its id
 * (`txn_…`), or null if checkout can't be started right now (API down,
 * billing not configured, unknown price). The caller redirects the browser to
 * `${checkoutUrl()}?_ptxn=<id>` on lector.dev, where the overlay opens on the
 * approved domain; the account is stamped into the transaction server-side
 * (custom_data.lectorUserId), so nothing identifying rides the URL.
 */
export async function startCheckout(priceId: string): Promise<string | null> {
  try {
    const res = await apiFetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { txnId?: string };
    return body.txnId ?? null;
  } catch {
    return null;
  }
}
