import { describe, test, expect } from 'bun:test';
import { isBlockedAddress, assertSafePublicUrl, safeFetch, SsrfError } from './safe-fetch';

describe('isBlockedAddress', () => {
  test('blocks internal / metadata / reserved IPv4', () => {
    for (const ip of [
      '127.0.0.1', // loopback
      '10.0.0.1', // private
      '172.16.5.4', // private
      '172.31.255.255', // private (upper bound)
      '192.168.1.1', // private
      '169.254.169.254', // link-local cloud metadata
      '100.64.0.1', // CGNAT
      '0.0.0.0', // "this host"
      '224.0.0.1', // multicast
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  test('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  test('blocks internal IPv6 (incl. IPv4-mapped loopback)', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  test('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  test('blocks non-IP input', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('assertSafePublicUrl', () => {
  test('rejects non-http(s) schemes', async () => {
    for (const u of ['ftp://example.com', 'file:///etc/passwd', 'gopher://x']) {
      await expect(assertSafePublicUrl(u)).rejects.toBeInstanceOf(SsrfError);
    }
  });

  test('rejects an unparseable URL', async () => {
    await expect(assertSafePublicUrl('not a url')).rejects.toBeInstanceOf(SsrfError);
  });

  test('rejects URLs that resolve to internal addresses (literal IPs)', async () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://[::1]/',
      'https://192.168.0.1/admin',
    ]) {
      await expect(assertSafePublicUrl(u)).rejects.toBeInstanceOf(SsrfError);
    }
  });

  test('allows a public literal IP', async () => {
    const u = await assertSafePublicUrl('http://1.1.1.1/');
    expect(u.protocol).toBe('http:');
  });
});

describe('safeFetch redirect validation', () => {
  test('revalidates every redirect and refuses an internal second hop', async () => {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/admin' },
      });
    }) as unknown as typeof fetch;

    try {
      await expect(safeFetch('http://1.1.1.1/start')).rejects.toBeInstanceOf(SsrfError);
      expect(seen).toEqual(['http://1.1.1.1/start']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
