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
import { authMiddleware } from './lib/auth';
import { startClassifyWorker } from './lib/classify-worker';
// Aliased: this file's Bun.serve export below is also named `config`.
import { config as deploymentConfig, assertBootableMode } from './lib/config';

// Fail-closed deployment-mode guard (#242): `cloud` requires accounts & auth
// (#218), which have not shipped — never boot today's fail-open API under a
// flag that promises tenant isolation. docker-entrypoint.sh enforces the same
// rule; this covers bare `bun run` deployments. Remove the guard when #218 lands.
try {
  assertBootableMode(deploymentConfig.mode);
} catch (err) {
  console.error(`FATAL: ${(err as Error).message}`);
  process.exit(1);
}

const app = new Hono();

// The browser talks to this API directly — the Next.js `/api/*` proxy was
// removed in #188, so the UI (:3000/:3400) and API (:3457) are different
// origins and every client call is cross-origin. CORS is therefore
// load-bearing now (it was dormant while the proxy did server-to-server
// fetches). Wide-open `*` is deliberate: a Tailnet-only app is reached from
// arbitrary hosts (localhost, Tailnet IPs, hostnames), so the allowed origin
// can't be pinned, and requests carry no credentials (auth is bearer-token).
app.use('*', cors());
app.use('*', logger());
app.use('/api/*', authMiddleware);

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

// Capture unhandled errors to Sentry/GlitchTip
app.onError((err, c) => {
  Sentry.captureException(err);
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Health check
app.get('/health', (c) => c.json({ ok: true }));

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
