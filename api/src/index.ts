import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import collections from './routes/collections';
import lessons from './routes/lessons';
import vocab from './routes/vocab';
import knownWords from './routes/known-words';
import cloze from './routes/cloze';
import stats from './routes/stats';
import settings from './routes/settings';
import translate from './routes/translate';
import explain from './routes/explain';
import tts from './routes/tts';
import tatoeba from './routes/tatoeba';
import anki from './routes/anki';
import studyPing from './routes/study-ping';
import data from './routes/data';
import extractUrl from './routes/extract-url';
import importRoutes from './routes/import';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());

app.route('/api/collections', collections);
app.route('/api/lessons', lessons);
app.route('/api/vocab', vocab);
app.route('/api/known-words', knownWords);
app.route('/api/cloze', cloze);
app.route('/api/stats', stats);
app.route('/api/settings', settings);
app.route('/api/translate', translate);
app.route('/api/explain', explain);
app.route('/api/tts', tts);
app.route('/api/tatoeba', tatoeba);
app.route('/api/anki', anki);
app.route('/api/study-ping', studyPing);
app.route('/api/data', data);
app.route('/api/extract-url', extractUrl);
app.route('/api/import', importRoutes);

// Health check
app.get('/health', (c) => c.json({ ok: true }));

const port = parseInt(process.env.PORT || '3457');

console.log(`Lector API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
