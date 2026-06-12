import { Sentry } from './lib/sentry';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import collections from './routes/collections';
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
import translateCompare from './routes/translate-compare';
import chat from './routes/chat';
import llmLmstudio from './routes/llm-lmstudio';
import { authMiddleware } from './lib/auth';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());
app.use('/api/*', authMiddleware);

app.route('/api/collections', collections);
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
app.route('/api/translate-compare', translateCompare);
app.route('/api/chat', chat);
app.route('/api/llm/lmstudio', llmLmstudio);

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

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // SSE streams for auto-evaluate need longer than the 10s default
};
