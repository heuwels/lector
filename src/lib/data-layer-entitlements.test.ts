import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tenantId: 'account-a' as string | null }));
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./api-base', () => ({ apiFetch }));
vi.mock('./language-cache', () => ({
  activeTenantId: () => state.tenantId,
  readLanguageCache: () => 'af',
}));

import { getEntitlements, invalidateEntitlementsCache } from './data-layer';

function entitlementResponse(plan: 'free' | 'cloud') {
  return new Response(
    JSON.stringify({
      plan,
      byok: false,
      limits: {},
      usage: {},
      periods: { day: '2026-07-11', month: '2026-07' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  invalidateEntitlementsCache();
  state.tenantId = 'account-a';
  apiFetch.mockReset();
});

describe('tenant-scoped entitlement cache', () => {
  it('reuses a fresh value only for the same account', async () => {
    apiFetch.mockResolvedValueOnce(entitlementResponse('free'));

    expect((await getEntitlements())?.plan).toBe('free');
    expect((await getEntitlements())?.plan).toBe('free');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does not leak a prior account plan after the active tenant changes', async () => {
    apiFetch
      .mockResolvedValueOnce(entitlementResponse('free'))
      .mockResolvedValueOnce(entitlementResponse('cloud'));

    expect((await getEntitlements())?.plan).toBe('free');
    state.tenantId = 'account-b';
    expect((await getEntitlements())?.plan).toBe('cloud');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('never caches a cloud read before a tenant is resolved', async () => {
    state.tenantId = null;
    apiFetch
      .mockResolvedValueOnce(entitlementResponse('free'))
      .mockResolvedValueOnce(entitlementResponse('free'));

    await getEntitlements();
    await getEntitlements();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
