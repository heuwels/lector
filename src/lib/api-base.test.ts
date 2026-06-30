import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiBase, apiUrl, apiFetch } from './api-base';

// The module reads `window.__ENV__` (browser) or `process.env.API_URL` (server)
// at call time, so each test sets the environment it needs and restores after.
type EnvWindow = { __ENV__?: { API_URL?: string } };

let savedApiUrl: string | undefined;

function setWindowEnv(apiUrl?: string) {
  (globalThis as unknown as { window?: EnvWindow }).window =
    apiUrl === undefined ? {} : { __ENV__: { API_URL: apiUrl } };
}
function clearWindow() {
  delete (globalThis as unknown as { window?: EnvWindow }).window;
}

beforeEach(() => {
  savedApiUrl = process.env.API_URL;
  delete process.env.API_URL;
  clearWindow();
});

afterEach(() => {
  if (savedApiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = savedApiUrl;
  clearWindow();
  vi.restoreAllMocks();
});

describe('apiBase', () => {
  it('defaults to localhost:3457 on the server when API_URL is unset', () => {
    expect(apiBase()).toBe('http://localhost:3457');
  });

  it('reads process.env.API_URL on the server, trimming a trailing slash', () => {
    process.env.API_URL = 'http://api-host:9999/';
    expect(apiBase()).toBe('http://api-host:9999');
  });

  it('reads window.__ENV__.API_URL in the browser', () => {
    setWindowEnv('https://lector.tailnet.ts.net:3457');
    expect(apiBase()).toBe('https://lector.tailnet.ts.net:3457');
  });

  it('trims a trailing slash from the injected browser value', () => {
    setWindowEnv('https://lector.example.com/');
    expect(apiBase()).toBe('https://lector.example.com');
  });

  it('falls back to localhost:3457 in the browser when __ENV__ is absent', () => {
    setWindowEnv(undefined); // window exists, but no __ENV__ (e.g. dev stub)
    expect(apiBase()).toBe('http://localhost:3457');
  });

  it('falls back to localhost:3457 in the browser when API_URL is empty', () => {
    setWindowEnv(''); // entrypoint wrote an empty API_URL
    expect(apiBase()).toBe('http://localhost:3457');
  });

  it('prefers the injected browser value over process.env.API_URL', () => {
    process.env.API_URL = 'http://server-only:1111';
    setWindowEnv('http://browser-value:3457');
    expect(apiBase()).toBe('http://browser-value:3457');
  });
});

describe('apiUrl', () => {
  it('joins an absolute path onto the base', () => {
    setWindowEnv('http://localhost:3457');
    expect(apiUrl('/api/vocab')).toBe('http://localhost:3457/api/vocab');
  });

  it('preserves the query string', () => {
    setWindowEnv('http://localhost:3457');
    expect(apiUrl('/api/cloze/due?limit=20&language=af')).toBe(
      'http://localhost:3457/api/cloze/due?limit=20&language=af',
    );
  });

  it('tolerates a path with no leading slash', () => {
    setWindowEnv('http://localhost:3457');
    expect(apiUrl('api/stats')).toBe('http://localhost:3457/api/stats');
  });
});

describe('apiFetch', () => {
  it('calls fetch with the resolved absolute URL and forwards init', async () => {
    setWindowEnv('http://localhost:3457');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const init = { method: 'POST', body: '{}' };
    await apiFetch('/api/vocab', init);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3457/api/vocab', init);
  });

  it('returns a synthetic JSON 502 when fetch rejects (API unreachable)', async () => {
    setWindowEnv('http://localhost:3457');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await apiFetch('/api/vocab');

    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });
});
