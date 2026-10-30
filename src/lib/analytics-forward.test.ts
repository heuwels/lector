import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptedHost,
  analyticsSiteKey,
  bootSource,
  clientIp,
  forwardingOrigin,
  handleAnalytics,
  stampCollectBody,
  websiteId,
} from './analytics-forward';
import { GET, POST } from '@/app/a/[[...path]]/route';

const WEBSITE = 'b59e9c65-ae32-47f1-8400-119fcf4861c4';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENV = {
  ANALYTICS_FORWARDING_URL: 'https://umami.example/ignored?q=1',
  ANALYTICS_WEBSITE_ID: WEBSITE.toUpperCase(),
};

function request(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LECTOR_MODE;
  delete process.env.ANALYTICS_FORWARDING_URL;
  delete process.env.ANALYTICS_WEBSITE_ID;
});

describe('forwardingOrigin', () => {
  it('keeps only an http(s) origin', () => {
    expect(forwardingOrigin(' https://umami.example/script.js?x=1#h ')).toBe('https://umami.example');
    expect(forwardingOrigin('http://127.0.0.1:3000/a')).toBe('http://127.0.0.1:3000');
  });

  it('rejects a missing, non-http, or credentialed value', () => {
    expect(forwardingOrigin(undefined)).toBeNull();
    expect(forwardingOrigin('')).toBeNull();
    expect(forwardingOrigin('not a url')).toBeNull();
    expect(forwardingOrigin('ftp://umami.example')).toBeNull();
    expect(forwardingOrigin('https://user:pass@umami.example')).toBeNull();
  });
});

describe('analyticsSiteKey', () => {
  it('maps the known hosts', () => {
    expect(analyticsSiteKey('lector.dev')).toBe('lector.dev');
    expect(analyticsSiteKey('WWW.lector.dev')).toBe('lector.dev');
    expect(analyticsSiteKey('site.sandbox.lector.dev')).toBe('site.sandbox.lector.dev');
    expect(analyticsSiteKey('abc.lector-site-staging.pages.dev')).toBe('site.sandbox.lector.dev');
    expect(analyticsSiteKey('lector-site-staging.pages.dev')).toBe('site.sandbox.lector.dev');
    expect(analyticsSiteKey('app.lector.dev:443')).toBe('app.lector.dev');
    expect(analyticsSiteKey('staging.lector.dev')).toBe('staging.lector.dev');
  });

  it('ignores localhost, previews, and other hosts', () => {
    expect(analyticsSiteKey('localhost')).toBeNull();
    expect(analyticsSiteKey('127.0.0.1')).toBeNull();
    expect(analyticsSiteKey('preview.lector-site.pages.dev')).toBeNull();
    expect(analyticsSiteKey('lector-site-avb.pages.dev')).toBeNull();
    expect(analyticsSiteKey('evil.com')).toBeNull();
    expect(analyticsSiteKey(null)).toBeNull();
  });
});

describe('websiteId', () => {
  it('accepts one uuid and rejects a hostname', () => {
    expect(websiteId(` ${WEBSITE.toUpperCase()} `)).toBe(WEBSITE);
    expect(websiteId('lector.dev')).toBeNull();
    expect(websiteId('')).toBeNull();
  });
});

describe('stampCollectBody', () => {
  it('writes the configured uuid when the field is absent or not a uuid', () => {
    const absent = stampCollectBody(JSON.stringify({ type: 'event', payload: { url: '/' } }), WEBSITE);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(JSON.parse(absent.body).payload.website).toBe(WEBSITE);

    const host = stampCollectBody(
      JSON.stringify({ type: 'event', payload: { website: 'lector.dev', url: '/' } }),
      WEBSITE,
    );
    expect(host.ok).toBe(true);
    if (host.ok) expect(JSON.parse(host.body).payload.website).toBe(WEBSITE);
  });

  it('rejects a different uuid and a broken body', () => {
    const other = stampCollectBody(JSON.stringify({ payload: { website: OTHER } }), WEBSITE);
    expect(other).toEqual({ ok: false, status: 400 });
    expect(stampCollectBody('{', WEBSITE)).toEqual({ ok: false, status: 400 });
    expect(stampCollectBody('[]', WEBSITE)).toEqual({ ok: false, status: 400 });
    expect(stampCollectBody('{"payload":[]}', WEBSITE)).toEqual({ ok: false, status: 400 });
    expect(stampCollectBody('x'.repeat(10_001), WEBSITE)).toEqual({ ok: false, status: 413 });
  });
});

describe('clientIp', () => {
  it('prefers the Cloudflare header', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.9',
      'x-forwarded-for': '198.51.100.4, 10.0.0.1',
    });
    expect(clientIp(headers)).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4');
  });
});

describe('bootSource', () => {
  it('sets the website id before the script address', () => {
    const source = bootSource(WEBSITE);
    expect(source.indexOf('data-website-id')).toBeLessThan(source.indexOf('el.src='));
    expect(source).toContain(WEBSITE);
    expect(source).toContain('umami.track');
    expect(() => new Function(source)).not.toThrow();
  });
});

describe('acceptedHost', () => {
  it('uses the Host header when the request URL is local', () => {
    const local = request('http://127.0.0.1:3000/a/boot.js', { headers: { host: 'app.lector.dev' } });
    expect(acceptedHost(local)).toBe('app.lector.dev');
  });
});

describe('handleAnalytics', () => {
  it('serves an empty boot script when analytics is off or the host is unknown', async () => {
    const off = await handleAnalytics(request('https://lector.dev/a/boot.js'), {});
    expect(await off.text()).toContain('analytics off');

    const preview = await handleAnalytics(request('https://preview.lector-site.pages.dev/a/boot.js'), ENV);
    expect(await preview.text()).toContain('analytics off');
    expect(preview.headers.get('cache-control')).toBe('no-store');
  });

  it('boots the known site and proxies the tracker script', async () => {
    const boot = await handleAnalytics(request('https://www.lector.dev/a/boot.js'), ENV);
    expect(await boot.text()).toContain(WEBSITE);

    const fetchMock = vi.fn(async () => new Response('window.umami={}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const script = await handleAnalytics(request('https://lector.dev/a/script.js'), ENV);
    expect(script.status).toBe(200);
    expect(script.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(fetchMock).toHaveBeenCalledWith('https://umami.example/script.js', { redirect: 'error' });
  });

  it('forwards the collect call without cookies and rejects a foreign website', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-umami-cache': 'jwt', 'set-cookie': 'nope=1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const sent = await handleAnalytics(
      request('https://app.lector.dev/a/api/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'TestBrowser/1',
          cookie: 'session=secret',
          'x-umami-cache': 'prior',
          'cf-connecting-ip': '203.0.113.8',
        },
        body: JSON.stringify({ type: 'event', payload: { url: '/read', website: 'lector.dev' } }),
      }),
      ENV,
    );
    expect(sent.status).toBe(200);
    expect(sent.headers.get('x-umami-cache')).toBe('jwt');
    expect(sent.headers.get('set-cookie')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://umami.example/api/send');
    const headers = new Headers(init.headers);
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('user-agent')).toBe('TestBrowser/1');
    expect(headers.get('x-umami-cache')).toBe('prior');
    expect(headers.get('x-real-ip')).toBe('203.0.113.8');
    expect(headers.get('x-forwarded-host')).toBe('app.lector.dev');
    expect(JSON.parse(String(init.body)).payload.website).toBe(WEBSITE);

    vi.unstubAllGlobals();
    const blocked = await handleAnalytics(
      request('https://app.lector.dev/a/api/send', {
        method: 'POST',
        body: JSON.stringify({ payload: { website: OTHER } }),
      }),
      ENV,
    );
    expect(blocked.status).toBe(400);
  });

  it('returns 502 when the origin is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const script = await handleAnalytics(request('https://lector.dev/a/script.js'), ENV);
    expect(script.status).toBe(502);
  });
});

describe('cloud route', () => {
  it('stays silent unless the deployment is cloud', async () => {
    process.env.LECTOR_MODE = 'selfhost';
    process.env.ANALYTICS_FORWARDING_URL = ENV.ANALYTICS_FORWARDING_URL;
    process.env.ANALYTICS_WEBSITE_ID = WEBSITE;
    const hidden = await GET(request('https://app.lector.dev/a/boot.js'));
    expect(hidden.status).toBe(404);

    process.env.LECTOR_MODE = 'cloud';
    const shown = await GET(request('https://app.lector.dev/a/boot.js'));
    expect(await shown.text()).toContain(WEBSITE);
    const missing = await POST(request('https://app.lector.dev/a/api/send', { method: 'POST' }));
    expect(missing.status).toBe(400);
  });
});
