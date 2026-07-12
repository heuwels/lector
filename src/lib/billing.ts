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

export interface BillingManagement {
  customerPortal: boolean;
  subscription: {
    plan: BillingPrice['plan'];
    cycle: BillingPrice['cycle'];
    canChange: boolean;
  } | null;
}

export interface BillingMoney {
  amount: string;
  currencyCode: string;
}

export interface PlanChangePreview {
  target: BillingPrice;
  prorationBillingMode: 'prorated_immediately' | 'prorated_next_billing_period';
  immediateCharge: BillingMoney | null;
  nextCharge: BillingMoney | null;
  recurringCharge: BillingMoney | null;
}

export type BillingActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Billing access and Paddle activation are deliberately separate. A Free
 * account is allowed into the app without having a subscription, while a
 * successful checkout is not considered active until Paddle's webhook lands.
 */
export interface BillingStatus {
  enforced: boolean;
  accessAllowed: boolean;
  subscriptionActive: boolean;
  freeTierEnabled: boolean;
  suspended: boolean;
  exempt: boolean;
  status: string;
  checkout: BillingCheckout;
  /** Optional during rolling deploys where the browser may briefly lead the API. */
  management?: BillingManagement;
}

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

async function billingAction<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<BillingActionResult<T>> {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: payload.error ?? 'billing_action_failed' };
    return { ok: true, value: payload };
  } catch {
    return { ok: false, error: 'billing_unavailable' };
  }
}

/** Mint a temporary, authenticated Paddle customer-portal URL. */
export async function createCustomerPortalSession(): Promise<BillingActionResult<{ url: string }>> {
  return billingAction<{ url: string }>('/api/billing/portal');
}

/** Ask Paddle to calculate taxes and proration without changing the subscription. */
export async function previewPlanChange(
  priceId: string,
): Promise<BillingActionResult<PlanChangePreview>> {
  return billingAction<PlanChangePreview>('/api/billing/change/preview', { priceId });
}

/** Request an already-previewed target price; entitlement still waits for the webhook. */
export async function applyPlanChange(
  priceId: string,
): Promise<BillingActionResult<{ accepted: true; target: BillingPrice }>> {
  return billingAction<{ accepted: true; target: BillingPrice }>('/api/billing/change', {
    priceId,
  });
}
