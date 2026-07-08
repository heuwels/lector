import { Sentry } from './lib/sentry';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import collections from './routes/collections';
import groups from './routes/groups';
import knownWords from './routes/known-words';
import studyPing from './routes/study-ping';
import tatoeba from './routes/tatoeba';
import tts from './routes/tts';
import extractUrl from './routes/extract-url';
import dictionary from './routes/dictionary';
import journal from './routes/journal';
import importRoutes from './routes/import';
import anki from './routes/anki';
import lessons from './routes/lessons';
import vocab from './routes/vocab';
import cloze from './routes/cloze';
import stats from './routes/stats';
import settings from './routes/settings';
import translate from './routes/translate';
import explain from './routes/explain';
import data from './routes/data';
import journalCorrect from './routes/journal-correct';
import llmStatus from './routes/llm-status';
import tokens from './routes/tokens';
import chat from './routes/chat';
import llmOpenai from './routes/llm-openai';
import billing from './routes/billing';
import { authMiddleware } from './lib/auth';
import { sessionMiddleware } from './lib/session';
import { assertBillingBootable, billingConfig, billingMiddleware } from './lib/billing';
import { getAuthEngine, runAuthMigrations, resolveTrustedOrigins } from './lib/accounts';
import { HTTPException } from 'hono/http-exception';
import { startClassifyWorker } from './lib/classify-worker';
// Aliased: this file's Bun.serve export below is also named `config`.
import { config as deploymentConfig, assertBootableMode } from './lib/config';

// Fail-closed deployment-mode guard (#242, re-purposed by #218): cloud proper
// runs built-in accounts & sessions and must never sign them with Better
// Auth's default dev secret — refuse to boot without BETTER_AUTH_SECRET.
// docker-entrypoint.sh enforces the same rule; this covers bare `bun run`
// deployments.
try {
  assertBootableMode(
    deploymentConfig.mode,
    deploymentConfig.cloudGate,
    Boolean(deploymentConfig.authSecret),
  );
  assertBillingBootable(
    billingConfig.mode,
    deploymentConfig.authRequired,
    Boolean(billingConfig.webhookSecret),
  );
} catch (err) {
  console.error(`FATAL: ${(err as Error).message}`);
  process.exit(1);
}
if (deploymentConfig.mode === 'cloud' && deploymentConfig.cloudGate === 'external') {
  console.warn(
    '[lector] cloud mode behind an EXTERNAL gate — app-level auth is delegated. ' +
      'Every request must pass an authenticating gateway (e.g. Cloudflare Access) ' +
      'before reaching this app; built-in accounts (#218) are not mounted.',
  );
}

const app = new Hono();

// ── Distributed tracing bridge (front-end → API → worker) ────────────────────
// Hono runs on Bun.serve (a fetch handler), not node:http, so Sentry's auto HTTP
// server instrumentation never fires. Bridge it by hand: continue the trace the
// browser SDK started — the sentry-trace/baggage headers it stamps on
// cross-origin calls (see src/instrumentation-client.ts's
// tracePropagationTargets) — and open one http.server span per request, so a
// browser action and the API work it triggers share a trace. Registered first so
// the span wraps CORS, auth, and routing. Skips OPTIONS preflights and the
// frequent /health probe to keep the trace stream signal-heavy. No-op when
// SENTRY_DSN is unset: startSpan still runs the handler, it just records nothing.
app.use('*', (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/health') return next();
  return Sentry.continueTrace(
    { sentryTrace: c.req.header('sentry-trace'), baggage: c.req.header('baggage') },
    () =>
      Sentry.startSpan(
        { name: `${c.req.method} ${c.req.path}`, op: 'http.server' },
        async (span) => {
          await next();
          span.setAttribute('http.response.status_code', c.res.status);
        },
      ),
  );
});

// The browser talks to this API directly — the Next.js `/api/*` proxy was
// removed in #188, so the UI (:3000/:3400) and API (:3457) are different
// origins and every client call is cross-origin. CORS is therefore
// load-bearing now (it was dormant while the proxy did server-to-server
// fetches).
//
// Selfhost / external gate: wide-open `*` is deliberate — a Tailnet-only app
// is reached from arbitrary hosts (localhost, Tailnet IPs, hostnames), so the
// allowed origin can't be pinned, and requests carry no credentials (auth is
// bearer-token or the gateway's).
//
// Cloud proper (#218): sessions ride cookies, and `*` is incompatible with
// credentialed requests — pin the trusted browser origins and allow
// credentials. (The canary/prod shape is same-origin path-split — one
// hostname, /api/* → :3457 — so this mostly serves cross-origin dev.)
if (deploymentConfig.authRequired) {
  app.use('*', cors({ origin: resolveTrustedOrigins(), credentials: true }));
} else {
  app.use('*', cors());
}
app.use('*', logger());
app.use('/api/*', sessionMiddleware);
app.use('/api/*', authMiddleware);
// Billing gate (#224) — after session/PAT so the tenant is resolved. A no-op
// unless LECTOR_BILLING=paddle (cloud proper only, boot-guarded above).
app.use('/api/*', billingMiddleware);

// Built-in accounts (#218): only cloud proper mounts the engine. Selfhost
// keeps its auth-off single-user shape (multi-user self-host is the same
// opt-in: LECTOR_MODE=cloud + BETTER_AUTH_SECRET on your own box); the
// external-gate canary keeps delegating to its gateway.
if (deploymentConfig.authRequired) {
  await runAuthMigrations(getAuthEngine());
  app.on(['POST', 'GET'], '/api/auth/*', (c) => getAuthEngine().handler(c.req.raw));
  console.log('[lector] cloud mode: built-in accounts & sessions active (Better Auth)');
}
if (billingConfig.enforced) {
  console.log('[lector] billing: Paddle subscription gate active (#224)');
}

app.route('/api/collections', collections);
app.route('/api/groups', groups);
app.route('/api/known-words', knownWords);
app.route('/api/study-ping', studyPing);
app.route('/api/tatoeba', tatoeba);
app.route('/api/tts', tts);
app.route('/api/extract-url', extractUrl);
app.route('/api/dictionary', dictionary);
app.route('/api/journal', journal);
app.route('/api/import', importRoutes);
app.route('/api/anki', anki);
app.route('/api/lessons', lessons);
app.route('/api/vocab', vocab);
app.route('/api/cloze', cloze);
app.route('/api/stats', stats);
app.route('/api/settings', settings);
app.route('/api/translate', translate);
app.route('/api/explain', explain);
app.route('/api/data', data);
app.route('/api/journal-correct', journalCorrect);
app.route('/api/llm-status', llmStatus);
app.route('/api/tokens', tokens);
app.route('/api/chat', chat);
app.route('/api/llm/openai', llmOpenai);
app.route('/api/billing', billing);

// Capture unhandled errors to Sentry/GlitchTip. Deliberate HTTP errors
// (e.g. the identity seam's fail-closed 401, lib/user.ts) pass through with
// their intended status instead of being masked as 500s.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  Sentry.captureException(err);
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Health check — reports the deployment mode so a canary can be smoke-checked
// end-to-end (e.g. curl .../health → {"ok":true,"mode":"cloud"}).
app.get('/health', (c) => c.json({ ok: true, mode: deploymentConfig.mode }));

const port = parseInt(process.env.PORT || '3457');

console.log(`Lector API running on http://localhost:${port}`);

// Background word→domain classifier for the fluency radar. No-op unless
// CLASSIFY_WORKER=1, so it only runs where it's explicitly enabled (this Hono
// process) and never under test/e2e.
startClassifyWorker();

const config = {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // SSE streams for auto-evaluate need longer than the 10s default
};

export default config;
