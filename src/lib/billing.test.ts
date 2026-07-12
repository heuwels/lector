import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));

import {
  applyPlanChange,
  createCustomerPortalSession,
  previewPlanChange,
  startCheckout,
} from './billing';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  apiFetch.mockReset();
});

describe('billing actions', () => {
  it('starts checkout with only the allowlisted price intent', async () => {
    apiFetch.mockResolvedValue(json({ txnId: 'txn_test' }));

    await expect(startCheckout('pri_annual')).resolves.toBe('txn_test');
    expect(apiFetch).toHaveBeenCalledWith('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: 'pri_annual' }),
    });
  });

  it('mints portal sessions without accepting a browser redirect target', async () => {
    apiFetch.mockResolvedValue(
      json({ url: 'https://customer-portal.paddle.com/session?token=temporary' }),
    );

    await expect(createCustomerPortalSession()).resolves.toEqual({
      ok: true,
      value: { url: 'https://customer-portal.paddle.com/session?token=temporary' },
    });
    expect(apiFetch).toHaveBeenCalledWith('/api/billing/portal', { method: 'POST' });
  });

  it('previews and applies the same target price through separate routes', async () => {
    const preview = {
      target: { id: 'pri_plus', plan: 'plus', cycle: 'year' },
      prorationBillingMode: 'prorated_immediately',
      immediateCharge: { amount: '700', currencyCode: 'USD' },
      nextCharge: null,
      recurringCharge: { amount: '12000', currencyCode: 'USD' },
    };
    apiFetch
      .mockResolvedValueOnce(json(preview))
      .mockResolvedValueOnce(json({ accepted: true, target: preview.target }, 202));

    await expect(previewPlanChange('pri_plus')).resolves.toEqual({ ok: true, value: preview });
    await expect(applyPlanChange('pri_plus')).resolves.toEqual({
      ok: true,
      value: { accepted: true, target: preview.target },
    });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/billing/change/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: 'pri_plus' }),
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/billing/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId: 'pri_plus' }),
    });
  });

  it('returns stable action errors without throwing provider details into the UI', async () => {
    apiFetch.mockResolvedValue(json({ error: 'subscription_past_due' }, 409));
    await expect(previewPlanChange('pri_plus')).resolves.toEqual({
      ok: false,
      error: 'subscription_past_due',
    });

    apiFetch.mockRejectedValue(new Error('network detail'));
    await expect(createCustomerPortalSession()).resolves.toEqual({
      ok: false,
      error: 'billing_unavailable',
    });
  });
});
