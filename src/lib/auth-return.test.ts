import { describe, expect, it } from 'vitest';
import {
  authHref,
  authReturnPathFromSearch,
  paidPlanFromSearch,
  promoFromSearch,
  sanitizeAuthReturnPath,
} from './auth-return';

describe('sanitizeAuthReturnPath', () => {
  it('allows only the paid-plan picker and canonicalizes its known plans', () => {
    expect(sanitizeAuthReturnPath('/subscribe')).toBe('/subscribe');
    expect(sanitizeAuthReturnPath('/subscribe?plan=cloud')).toBe('/subscribe?plan=cloud');
    expect(sanitizeAuthReturnPath('/subscribe?plan=plus')).toBe('/subscribe?plan=plus');
  });

  it('carries a campaign code word through, normalized and in a stable order', () => {
    expect(sanitizeAuthReturnPath('/subscribe?promo=PRODUCTHUNT')).toBe(
      '/subscribe?promo=PRODUCTHUNT',
    );
    expect(sanitizeAuthReturnPath('/subscribe?promo=producthunt')).toBe(
      '/subscribe?promo=PRODUCTHUNT',
    );
    expect(sanitizeAuthReturnPath('/subscribe?plan=plus&promo=WINBACK25')).toBe(
      '/subscribe?plan=plus&promo=WINBACK25',
    );
    // Order in, canonical order out — the destination is rebuilt, not echoed.
    expect(sanitizeAuthReturnPath('/subscribe?promo=WINBACK25&plan=plus')).toBe(
      '/subscribe?plan=plus&promo=WINBACK25',
    );
  });

  it('rejects a code word that could never be one, including a Paddle discount id', () => {
    expect(sanitizeAuthReturnPath('/subscribe?promo=dsc_01k9')).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?promo=with%20space')).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?promo=')).toBeNull();
    expect(sanitizeAuthReturnPath(`/subscribe?promo=${'A'.repeat(33)}`)).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?promo=A&promo=B')).toBeNull();
  });

  it('rejects external, protocol-relative, malformed, and unrelated destinations', () => {
    expect(sanitizeAuthReturnPath('https://example.com/subscribe?plan=cloud')).toBeNull();
    expect(sanitizeAuthReturnPath('//example.com/subscribe?plan=cloud')).toBeNull();
    expect(sanitizeAuthReturnPath('/settings')).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?plan=enterprise')).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?plan=cloud&coupon=surprise')).toBeNull();
    expect(sanitizeAuthReturnPath('/subscribe?plan=cloud#checkout')).toBeNull();
  });
});

describe('auth return helpers', () => {
  it('reads an encoded next destination and builds auth links without double encoding', () => {
    const href = authHref('/register', '/subscribe?plan=plus');
    expect(href).toBe('/register?next=%2Fsubscribe%3Fplan%3Dplus');
    expect(authReturnPathFromSearch(href.slice(href.indexOf('?')))).toBe('/subscribe?plan=plus');
  });

  it('drops rejected destinations instead of emitting a next parameter', () => {
    expect(authHref('/login', 'https://example.com')).toBe('/login');
    expect(authReturnPathFromSearch('?next=%2Fsettings')).toBeNull();
  });

  it('recognizes only the two checkout plans', () => {
    expect(paidPlanFromSearch('?plan=cloud')).toBe('cloud');
    expect(paidPlanFromSearch('?plan=plus')).toBe('plus');
    expect(paidPlanFromSearch('?plan=free')).toBeNull();
  });

  it('normalizes a code word off the subscribe query and drops junk', () => {
    expect(promoFromSearch('?promo=producthunt')).toBe('PRODUCTHUNT');
    expect(promoFromSearch('?plan=cloud&promo=WINBACK25')).toBe('WINBACK25');
    expect(promoFromSearch('?plan=cloud')).toBeNull();
    expect(promoFromSearch('?promo=dsc_01k9')).toBeNull();
  });

  it('preserves a code word through an auth round trip', () => {
    const href = authHref('/register', '/subscribe?plan=plus&promo=PRODUCTHUNT');
    expect(authReturnPathFromSearch(href.slice(href.indexOf('?')))).toBe(
      '/subscribe?plan=plus&promo=PRODUCTHUNT',
    );
  });
});
