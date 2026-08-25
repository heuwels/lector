import type { Hono } from 'hono';

import collections from './collections';
import groups from './groups';
import knownWords from './known-words';
import studyPing from './study-ping';
import tatoeba from './tatoeba';
import tts from './tts';
import extractUrl from './extract-url';
import dictionary from './dictionary';
import journal from './journal';
import importRoutes from './import';
import youtubeImport from './youtube-import';
import anki from './anki';
import lessons from './lessons';
import vocab from './vocab';
import cloze from './cloze';
import stats from './stats';
import settings from './settings';
import starter from './starter';
import translate from './translate';
import explain from './explain';
import data from './data';
import journalCorrect from './journal-correct';
import llmStatus from './llm-status';
import tokens from './tokens';
import chat from './chat';
import llmOpenai from './llm-openai';
import billing from './billing';
import admin from './admin';
import impersonation from './impersonation';
import byok from './byok';
import onboarding from './onboarding';
import learnerEvents from './learner-events';
import emailUnsubscribe from './email-unsubscribe';

export type RouteMount = {
  /** Mount prefix, exactly as `app.route()` receives it. */
  readonly prefix: string;
  /** The mounted sub-app. */
  readonly app: Hono;
};

/**
 * Every mounted API route module, in mount order.
 *
 * `index.ts` iterates this table to build the served app, and
 * `scripts/gen-openapi.ts` iterates the same table to enumerate endpoints.
 * One table means the published OpenAPI document cannot drift from the routes
 * the app actually serves. Add a new module here, never in `index.ts`.
 *
 * Two things `index.ts` serves stay outside this table, because neither is a
 * route module:
 *
 * - `/health`. `extraEndpoints` in `lib/openapi/annotations.ts` carries it, so
 *   the document holds it.
 * - `/api/auth/*`, which is Better Auth's own handler, in cloud mode only.
 *   Better Auth owns that contract and documents it, so our document leaves it
 *   out on purpose. See `lib/openapi/description.md`.
 *
 * The drift gate reads this table plus `extraEndpoints`. It therefore cannot
 * see a route that `index.ts` registers directly, so register routes here.
 */
export const routeMounts: readonly RouteMount[] = [
  { prefix: '/api/collections', app: collections },
  { prefix: '/api/groups', app: groups },
  { prefix: '/api/known-words', app: knownWords },
  { prefix: '/api/study-ping', app: studyPing },
  { prefix: '/api/tatoeba', app: tatoeba },
  { prefix: '/api/tts', app: tts },
  { prefix: '/api/extract-url', app: extractUrl },
  { prefix: '/api/dictionary', app: dictionary },
  { prefix: '/api/journal', app: journal },
  { prefix: '/api/import', app: importRoutes },
  { prefix: '/api/import/youtube', app: youtubeImport },
  { prefix: '/api/anki', app: anki },
  { prefix: '/api/lessons', app: lessons },
  { prefix: '/api/vocab', app: vocab },
  { prefix: '/api/cloze', app: cloze },
  { prefix: '/api/stats', app: stats },
  { prefix: '/api/settings', app: settings },
  { prefix: '/api/starter', app: starter },
  { prefix: '/api/translate', app: translate },
  { prefix: '/api/explain', app: explain },
  { prefix: '/api/data', app: data },
  { prefix: '/api/journal-correct', app: journalCorrect },
  { prefix: '/api/llm-status', app: llmStatus },
  { prefix: '/api/tokens', app: tokens },
  { prefix: '/api/chat', app: chat },
  { prefix: '/api/llm/openai', app: llmOpenai },
  { prefix: '/api/billing', app: billing },
  { prefix: '/api/admin', app: admin },
  { prefix: '/api/impersonation', app: impersonation },
  { prefix: '/api/byok', app: byok },
  { prefix: '/api/onboarding', app: onboarding },
  { prefix: '/api/learner-events', app: learnerEvents },
  { prefix: '/api/email/unsubscribe', app: emailUnsubscribe },
];
