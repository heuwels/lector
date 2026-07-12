import { describe, expect, it } from 'vitest';
import {
  authHref,
  authReturnPathFromSearch,
  paidPlanFromSearch,
  sanitizeAuthReturnPath,
} from './auth-return';

describe('sanitizeAuthReturnPath', () => {
  it('allows only the paid-plan picker and canonicalizes its known plans', () => {
    expect(sanitizeAuthReturnPath('/subscribe')).toBe('/subscribe');
    expect(sanitizeAuthReturnPath('/subscribe?plan=cloud')).toBe('/subscribe?plan=cloud');
    expect(sanitizeAuthReturnPath('/subscribe?plan=plus')).toBe('/subscribe?plan=plus');
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
});
