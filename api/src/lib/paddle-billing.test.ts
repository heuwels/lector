import '../test-guard';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { makePaddleBillingOperations, type SubscriptionChangeArgs } from './paddle-billing';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const change: SubscriptionChangeArgs = {
  subscriptionId: 'sub_test',
  targetPriceId: 'pri_plus_month',
  managedPriceIds: ['pri_cloud_month', 'pri_plus_month'],
  prorationBillingMode: 'prorated_immediately',
};

describe('Paddle account-management operations', () => {
  test('creates a temporary portal session with server-owned subscription ids', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return json(
        {
          data: {
            urls: {
              general: {
                overview:
                  'https://sandbox-customer-portal.paddle.com/cpl_test?action=overview&token=x',
              },
            },
          },
        },
        201,
      );
    }) as unknown as typeof fetch;

    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'sandbox',
    });
    const url = await operations.createPortalSession({
      customerId: 'ctm_test',
      subscriptionIds: ['sub_test', 'sub_test', 'sub_old'],
    });

    expect(url).toBe('https://sandbox-customer-portal.paddle.com/cpl_test?action=overview&token=x');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sandbox-api.paddle.com/customers/ctm_test/portal-sessions');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      subscription_ids: ['sub_test', 'sub_old'],
    });
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer pdl_key');
  });

  test('rejects a portal redirect outside Paddle', async () => {
    globalThis.fetch = mock(async () =>
      json({ data: { urls: { general: { overview: 'https://evil.example/steal' } } } }, 201),
    ) as unknown as typeof fetch;
    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'production',
    });

    await expect(
      operations.createPortalSession({ customerId: 'ctm_test', subscriptionIds: [] }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  test('rejects a portal redirect for the other Paddle environment', async () => {
    globalThis.fetch = mock(async () =>
      json(
        {
          data: {
            urls: {
              general: {
                overview: 'https://sandbox-customer-portal.paddle.com/cpl_test?token=x',
              },
            },
          },
        },
        201,
      ),
    ) as unknown as typeof fetch;
    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'production',
    });

    await expect(
      operations.createPortalSession({ customerId: 'ctm_test', subscriptionIds: [] }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  test('previews a base-price swap while preserving unrelated subscription items', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return json({
          data: {
            items: [
              { quantity: 1, price: { id: 'pri_cloud_month' } },
              { quantity: 3, price: { id: 'pri_future_addon' } },
            ],
          },
        });
      }
      return json({
        data: {
          currency_code: 'USD',
          immediate_transaction: { details: { totals: { grand_total: '425' } } },
          next_transaction: null,
          recurring_transaction_details: {
            totals: { grand_total: '1200', currency_code: 'USD' },
          },
        },
      });
    }) as unknown as typeof fetch;

    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'production',
    });
    const preview = await operations.previewSubscriptionChange(change);

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['https://api.paddle.com/subscriptions/sub_test', 'GET'],
      ['https://api.paddle.com/subscriptions/sub_test/preview', 'PATCH'],
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      items: [
        { price_id: 'pri_future_addon', quantity: 3 },
        { price_id: 'pri_plus_month', quantity: 1 },
      ],
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
    });
    expect(preview).toEqual({
      immediateCharge: { amount: '425', currencyCode: 'USD' },
      nextCharge: null,
      recurringCharge: { amount: '1200', currencyCode: 'USD' },
    });
  });

  test('re-reads the subscription before applying the confirmed target', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return json({
          data: { items: [{ quantity: 1, price: { id: 'pri_cloud_month' } }] },
        });
      }
      return json({ data: { id: 'sub_test', status: 'active' } });
    }) as unknown as typeof fetch;

    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'production',
    });
    await operations.applySubscriptionChange(change);

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['https://api.paddle.com/subscriptions/sub_test', 'GET'],
      ['https://api.paddle.com/subscriptions/sub_test', 'PATCH'],
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      items: [{ price_id: 'pri_plus_month', quantity: 1 }],
      on_payment_failure: 'prevent_change',
    });
  });

  test('refuses a stale repeat or a subscription without one managed base price', async () => {
    const operations = makePaddleBillingOperations({
      apiKey: 'pdl_key',
      environment: 'production',
    });

    globalThis.fetch = mock(async () =>
      json({ data: { items: [{ quantity: 1, price: { id: 'pri_plus_month' } }] } }),
    ) as unknown as typeof fetch;
    await expect(operations.applySubscriptionChange(change)).rejects.toMatchObject({
      code: 'already_current',
    });

    globalThis.fetch = mock(async () =>
      json({ data: { items: [{ quantity: 1, price: { id: 'pri_unknown' } }] } }),
    ) as unknown as typeof fetch;
    await expect(operations.previewSubscriptionChange(change)).rejects.toMatchObject({
      code: 'managed_price_mismatch',
    });
  });
});
