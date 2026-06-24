import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF-hardened fetch for user-supplied URLs (extract-url).
 *
 * The route fetches an arbitrary URL the user pastes, so without guards it can be
 * pointed at internal services or the cloud metadata endpoint
 * (169.254.169.254) — and a public URL can 30x-redirect to an internal one. This
 * module: (1) allows only http(s); (2) resolves the hostname and rejects any
 * answer in loopback/private/link-local/ULA/CGNAT/reserved space; (3) follows
 * redirects manually, re-validating every hop; (4) caps the response body.
 *
 * Residual: a determined attacker controlling DNS could rebind between our
 * lookup() and fetch()'s own resolution (TOCTOU). Fully closing that needs a
 * custom dispatcher that connects to the vetted IP — out of scope here; this
 * blocks the practical cases (literal internal IPs, static internal DNS,
 * redirect-to-internal).
 */
export class SsrfError extends Error {}

function ipv4IsBlocked(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → block
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

function ipv6IsBlocked(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped/-embedded (::ffff:1.2.3.4 or ::1.2.3.4) → classify the IPv4.
  const embedded = lower.match(/((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded && (lower.startsWith('::ffff:') || lower.startsWith('::'))) {
    return ipv4IsBlocked(embedded[1]);
  }
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  // fe80::/10 link-local (fe8/fe9/fea/feb prefixes)
  if (/^fe[89ab]/.test(lower)) return true;
  // fc00::/7 unique-local
  if (/^f[cd]/.test(lower)) return true;
  return false;
}

/** True if `ip` (a literal IPv4/IPv6) is in a range we must not fetch. */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4IsBlocked(ip);
  if (kind === 6) return ipv6IsBlocked(ip);
  return true; // not a usable IP literal → block
}

/**
 * Validate a URL is http(s) and resolves only to public addresses. Returns the
 * parsed URL, or throws SsrfError.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('Only http(s) URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SsrfError('Could not resolve host');
  }
  if (addresses.length === 0) throw new SsrfError('Could not resolve host');
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfError('URL resolves to a non-public address');
    }
  }
  return url;
}

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
}

/**
 * fetch() that validates the target (and every redirect hop) is a public
 * http(s) address before connecting. Redirects are followed manually so each
 * Location is re-validated.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = 5, ...init } = options;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertSafePublicUrl(current);
    const res = await fetch(validated.toString(), { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, validated).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError('Too many redirects');
}

/** Read a response body, aborting if it exceeds `maxBytes`. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SsrfError('Response too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
