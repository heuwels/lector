import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiBase, apiUrl, apiFetch } from './api-base';

// The module reads env + window at call time, so each test just sets the
// environment it needs and restores afterward.
const ENV_KEYS = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_API_PORT', 'INTERNAL_API_URL'] as const;
const saved: Record<string, string | undefined> = {};

function setWindow(hostname: string, protocol = 'http:') {
  (globalThis as unknown as { window?: unknown }).window = {
    location: { hostname, protocol },
  };
}
function clearWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  clearWindow();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearWindow();
  vi.restoreAllMocks();
});

describe('apiBase', () => {
  it('defaults to localhost:3457 off the browser (no window)', () => {
    expect(apiBase()).toBe('http://localhost:3457');
  });

  it('uses INTERNAL_API_URL off the browser when set, trimming a trailing slash', () => {
    process.env.INTERNAL_API_URL = 'http://api-host:9999/';
    expect(apiBase()).toBe('http://api-host:9999');
  });

  it('derives {protocol}//{hostname}:3457 in the browser', () => {
    setWindow('100.64.1.2', 'http:');
    expect(apiBase()).toBe('http://100.64.1.2:3457');
  });

  it('preserves the page protocol (https) when deriving in the browser', () => {
    setWindow('lector.tailnet.ts.net', 'https:');
    expect(apiBase()).toBe('https://lector.tailnet.ts.net:3457');
  });

  it('honors NEXT_PUBLIC_API_PORT in the browser', () => {
    setWindow('localhost', 'http:');
    process.env.NEXT_PUBLIC_API_PORT = '4000';
    expect(apiBase()).toBe('http://localhost:4000');
  });

  it('lets NEXT_PUBLIC_API_URL override everything (browser)', () => {
    setWindow('localhost', 'http:');
    process.env.NEXT_PUBLIC_API_URL = 'https://lector.example.com/';
    expect(apiBase()).toBe('https://lector.example.com');
  });

  it('lets NEXT_PUBLIC_API_URL override everything (server)', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://lector.example.com';
    expect(apiBase()).toBe('https://lector.example.com');
  });
});

describe('apiUrl', () => {
  it('joins an absolute path onto the base', () => {
    setWindow('localhost', 'http:');
    expect(apiUrl('/api/vocab')).toBe('http://localhost:3457/api/vocab');
  });

  it('preserves the query string', () => {
    setWindow('localhost', 'http:');
    expect(apiUrl('/api/cloze/due?limit=20&language=af')).toBe(
      'http://localhost:3457/api/cloze/due?limit=20&language=af',
    );
  });

  it('tolerates a path with no leading slash', () => {
    setWindow('localhost', 'http:');
    expect(apiUrl('api/stats')).toBe('http://localhost:3457/api/stats');
  });
});

describe('apiFetch', () => {
  it('calls fetch with the resolved absolute URL and forwards init', async () => {
    setWindow('localhost', 'http:');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const init = { method: 'POST', body: '{}' };
    await apiFetch('/api/vocab', init);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3457/api/vocab', init);
  });

  it('returns a synthetic JSON 502 when fetch rejects (API unreachable)', async () => {
    setWindow('localhost', 'http:');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await apiFetch('/api/vocab');

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });
});
