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
import starter from './routes/starter';
import translate from './routes/translate';
import explain from './routes/explain';
import data from './routes/data';
import journalCorrect from './routes/journal-correct';
import llmStatus from './routes/llm-status';
import tokens from './routes/tokens';
import chat from './routes/chat';
import llmOpenai from './routes/llm-openai';
import billing from './routes/billing';
import admin from './routes/admin';
import byok from './routes/byok';
import onboarding from './routes/onboarding';
import learnerEvents from './routes/learner-events';
import { authMiddleware } from './lib/auth';
import { sessionMiddleware } from './lib/session';
import { assertBillingBootable, billingConfig, billingMiddleware } from './lib/billing';
import { accountStatusMiddleware } from './lib/admin';
import { getAuthEngine, runAuthMigrations, resolveTrustedOrigins } from './lib/accounts';
import { HTTPException } from 'hono/http-exception';
import { startClassifyWorker } from './lib/classify-worker';
import { isByokAvailable } from './lib/byok';
import { defaultRequestBodyLimit } from './lib/request-body-limit';
// Aliased: this file's Bun.serve export below is also named `config`.
import {
  config as deploymentConfig,
  assertBootableMode,
  isProductionEnvironment,
} from './lib/config';

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
    Boolean(billingConfig.apiKey),
    {
      enabled: billingConfig.freeTierEnabled,
      production: isProductionEnvironment(process.env.NODE_ENV),
      hasTurnstileSecret: Boolean(process.env.TURNSTILE_SECRET_KEY),
      hasTurnstileSiteKey: Boolean(process.env.TURNSTILE_SITE_KEY),
      hasCheckoutPrice: billingConfig.prices.length > 0,
      hasGoogleTtsApiKey: Boolean(process.env.GOOGLE_CLOUD_API_KEY),
      byokAvailable: isByokAvailable(),
      classifyWorkerEnabled: process.env.CLASSIFY_WORKER === '1',
      classifyLlmUrl: process.env.CLASSIFY_LLM_URL,
      classifyLlmModel: process.env.CLASSIFY_LLM_MODEL,
      llmProvider: process.env.LLM_PROVIDER,
      openAiCompatUrl: process.env.OPENAI_COMPAT_URL,
      hasOpenAiCompatApiKey: Boolean(process.env.OPENAI_COMPAT_API_KEY),
      wordGlossModel: process.env.OPENAI_COMPAT_WORD_GLOSS_MODEL,
      simplePhraseModel: process.env.OPENAI_COMPAT_SIMPLE_PHRASE_MODEL,
      simpleContextModel: process.env.OPENAI_COMPAT_SIMPLE_CONTEXT_MODEL,
    },
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

// ── Distributed tracing: parameterize the auto span's transaction name ───────
app.use('*', async (c, next) => {
  await next();
  // @sentry/bun auto-instruments the served fetch handler: per request it opens an
  // http.server span, continues the inbound sentry-trace/baggage the browser SDK
  // stamps on its cross-origin calls (so the browser's trace and the API work it
  // triggers share ONE trace — see src/instrumentation-client.ts), and isolates
  // the scope. The only thing it gets wrong for a parameterized API is the
  // transaction NAME: it uses the raw path (e.g. /api/vocab/abc,
  // /api/dictionary/<word>), which explodes transaction cardinality and defeats
  // per-route aggregation. Relabel the request's root span with the matched route,
  // now that routing has resolved (c.req.routePath → "/api/vocab/:id"). No-op when
  // tracing is off/unsampled (getActiveSpan → undefined) or the path didn't match
  // a route (routePath stays "/*", e.g. a CORS preflight short-circuited by cors()).
  const active = Sentry.getActiveSpan();
  const routePath = c.req.routePath;
  if (active && routePath && routePath !== '/*') {
    const root = Sentry.getRootSpan(active);
    root.updateName(`${c.req.method} ${routePath}`);
    root.setAttribute('http.route', routePath);
    root.setAttribute('http.response.status_code', c.res.status);
  }
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
// Bound every ordinary API body before session/auth/route code can buffer or
// parse it. Restore, EPUB import, and Paddle webhook own stricter/different
// route-level contracts and are exact-path exemptions in the helper.
app.use('/api/*', defaultRequestBodyLimit);
app.use('*', logger());
app.use('/api/*', sessionMiddleware);
app.use('/api/*', authMiddleware);
// Account-status gate (#221) — after session/PAT (tenant resolved), before
// billing. A no-op unless cloud proper; there it locks a manually-suspended
// account to the same escape hatches as a billing lapse (auth/billing/admin/
// data-takeout).
app.use('/api/*', accountStatusMiddleware);
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
if (billingConfig.freeTierEnabled) {
  console.log('[lector] billing: derived Free account access active');
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
app.route('/api/starter', starter);
app.route('/api/translate', translate);
app.route('/api/explain', explain);
app.route('/api/data', data);
app.route('/api/journal-correct', journalCorrect);
app.route('/api/llm-status', llmStatus);
app.route('/api/tokens', tokens);
app.route('/api/chat', chat);
app.route('/api/llm/openai', llmOpenai);
app.route('/api/billing', billing);
app.route('/api/admin', admin);
app.route('/api/byok', byok);
app.route('/api/onboarding', onboarding);
app.route('/api/learner-events', learnerEvents);

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
