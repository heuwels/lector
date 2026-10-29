/**
 * Same-origin proxy in front of Umami.
 *
 * ANALYTICS_FORWARDING_URL is the Umami origin. It never reaches the browser.
 * The hostname selects which Lector site this request belongs to. Umami still
 * requires a website UUID, so ANALYTICS_WEBSITE_ID is set per deployment.
 * The tracker records the real hostname on the event.
 */

const MAX_BODY = 10_000;
const MAX_SCRIPT = 1_000_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFF = '/* analytics off */\n';

export type AnalyticsEnv = {
  ANALYTICS_FORWARDING_URL?: string;
  ANALYTICS_WEBSITE_ID?: string;
};

export function forwardingOrigin(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.origin;
}

function bareHost(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, '');
  return host || null;
}

/** Canonical site key. Null means this host does not get a tracker. */
export function analyticsSiteKey(hostname: string | null | undefined): string | null {
  const host = bareHost(hostname);
  if (!host) return null;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  if (host === 'site.sandbox.lector.dev') return host;
  if (host === 'lector-site-staging.pages.dev' || host.endsWith('.lector-site-staging.pages.dev')) {
    return 'site.sandbox.lector.dev';
  }
  if (host === 'lector.dev' || host === 'www.lector.dev') return 'lector.dev';
  if (host === 'app.lector.dev' || host === 'staging.lector.dev') return host;
  return null;
}

export function websiteId(raw: string | undefined | null): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || !UUID_RE.test(value)) return null;
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Host we will accept. URL hostname wins. The Host header covers a local proxy. */
export function acceptedHost(request: Request): string | null {
  let fromUrl: string | null = null;
  try {
    fromUrl = bareHost(new URL(request.url).hostname);
  } catch {
    fromUrl = null;
  }
  if (fromUrl && analyticsSiteKey(fromUrl)) return fromUrl;
  const fromHeader = bareHost(request.headers.get('host'));
  if (fromHeader && analyticsSiteKey(fromHeader)) return fromHeader;
  return null;
}

export function clientIp(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = headers.get('x-real-ip')?.split(',')[0]?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || null;
}

type Stamp = { ok: true; body: string } | { ok: false; status: number };

export function stampCollectBody(raw: string, website: string): Stamp {
  if (raw.length > MAX_BODY) return { ok: false, status: 413 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400 };
  }
  const root = parsed as { payload?: unknown };
  const payload = root.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400 };
  }
  const record = payload as { website?: unknown };
  const current = record.website;
  if (current === undefined || current === null || current === '') {
    record.website = website;
  } else if (!isUuid(current)) {
    record.website = website;
  } else if (current.toLowerCase() !== website) {
    return { ok: false, status: 400 };
  } else {
    record.website = website;
  }
  return { ok: true, body: JSON.stringify(parsed) };
}

/** Set the website id before src. A cached script can run as soon as src is set. */
export function bootSource(id: string): string {
  const literal = JSON.stringify(id);
  return (
    `(function(){var id=${literal};` +
    `var el=document.createElement("script");el.async=true;` +
    `el.setAttribute("data-website-id",id);` +
    `el.addEventListener("load",function(){` +
    `var queued=(window.plausible&&window.plausible.q)||[];` +
    `window.plausible=function(){var options=arguments[1];var data=options&&options.props;` +
    `if(window.umami&&typeof window.umami.track==="function")window.umami.track(arguments[0],data);};` +
    `for(var i=0;i<queued.length;i++)window.plausible(queued[i][0],queued[i][1]);});` +
    `el.src="/a/script.js";document.head.appendChild(el);})();\n`
  );
}

function scriptResponse(body: string, cache: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': cache,
    },
  });
}

function plain(status: number): Response {
  const message =
    status === 404 ? 'not found' : status === 413 ? 'too large' : status === 400 ? 'bad request' : 'bad gateway';
  return new Response(message, { status, headers: { 'cache-control': 'no-store' } });
}

async function proxyScript(origin: string): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/script.js`, { redirect: 'error' });
  } catch {
    return plain(502);
  }
  if (!upstream.ok) return plain(502);
  const body = await upstream.text();
  if (body.length > MAX_SCRIPT) return plain(502);
  return scriptResponse(body, 'public, max-age=3600');
}

async function proxySend(request: Request, origin: string, website: string, host: string): Promise<Response> {
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_BODY) return plain(413);
  const stamped = stampCollectBody(await request.text(), website);
  if (!stamped.ok) return plain(stamped.status);

  const headers = new Headers();
  headers.set('content-type', 'application/json');
  const userAgent = request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);
  const cache = request.headers.get('x-umami-cache');
  if (cache) headers.set('x-umami-cache', cache);
  const ip = clientIp(request.headers);
  if (ip) headers.set('x-real-ip', ip);
  headers.set('x-forwarded-host', host);

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/api/send`, {
      method: 'POST',
      headers,
      body: stamped.body,
      redirect: 'error',
    });
  } catch {
    return plain(502);
  }

  const out = new Headers();
  out.set('cache-control', 'no-store');
  const type = upstream.headers.get('content-type');
  if (type) out.set('content-type', type);
  const outCache = upstream.headers.get('x-umami-cache');
  if (outCache) out.set('x-umami-cache', outCache);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function handleAnalytics(request: Request, env: AnalyticsEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  const host = acceptedHost(request);
  const origin = forwardingOrigin(env.ANALYTICS_FORWARDING_URL);
  const website = websiteId(env.ANALYTICS_WEBSITE_ID);
  const ready = Boolean(host && origin && website);

  if (request.method === 'GET' && path === '/a/boot.js') {
    return scriptResponse(ready && website ? bootSource(website) : OFF, 'no-store');
  }
  if (!ready || !origin || !website || !host) return plain(404);
  if (request.method === 'GET' && path === '/a/script.js') return proxyScript(origin);
  if (request.method === 'POST' && path === '/a/api/send') return proxySend(request, origin, website, host);
  return plain(404);
}
