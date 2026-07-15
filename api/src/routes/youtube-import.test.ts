import '../test-guard';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { db, type LessonRow } from '../db';
import { makeEntitlements, parsePlanLimitOverrides, type PlanLimits } from '../lib/entitlements';
import type { ExtractionBurstLimiter } from '../lib/rate-limit';
import { makeYoutubeImportRoutes, type FetchPlayer, type FetchTranscript } from './youtube-import';

function strictEngine(overrides: Partial<PlanLimits> = {}) {
  const defaults = parsePlanLimitOverrides(undefined);
  return makeEntitlements({
    enforced: true,
    freeTierEnabled: true,
    exemptEmails: new Set(),
    prices: [],
    planLimits: {
      ...defaults,
      free: {
        ...defaults.free,
        maxCollections: 100,
        maxLessons: 100,
        maxLessonTextBytes: 1_000_000,
        maxLessonTextBytesTotal: 10_000_000,
        maxCollectionMetadataBytes: 10_000,
        ...overrides,
      },
    },
    resolveEmail: () => null,
    isByok: () => false,
    compedPlan: () => null,
    now: () => new Date('2026-07-15T12:00:00Z'),
  });
}

const allowAllLimiter = { tryConsume: () => true } as unknown as ExtractionBurstLimiter;

const PLAYER = {
  videoDetails: { title: 'Learning Afrikaans', author: 'Taalkanaal' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=vid00000001&lang=af',
          name: { simpleText: 'Afrikaans' },
          languageCode: 'af',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=vid00000001&lang=af&kind=asr',
          name: { simpleText: 'Afrikaans' },
          languageCode: 'af',
          kind: 'asr',
        },
      ],
    },
  },
};

const TRANSCRIPT = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Die kat sit' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'op die mat' }] },
  ],
};

const NO_CAPTIONS_PLAYER = { videoDetails: { title: 'x', author: 'y' } };
const VIDEO_URL = 'https://www.youtube.com/watch?v=vid00000001';

// Injectable player + transcript fetchers that serve fixtures and record their
// calls — proving no live YouTube (InnerTube) request is ever made in tests.
interface FakeOpts {
  player?: unknown | null;
  playerStatus?: number;
  transcript?: string;
  transcriptStatus?: number;
}
function fakeDeps(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const fetchPlayer: FetchPlayer = async (videoId) => {
    calls.push(`player:${videoId}`);
    const status = opts.playerStatus ?? 200;
    const player = 'player' in opts ? opts.player : PLAYER;
    return { status, player: status === 200 ? (player ?? null) : null };
  };
  const fetchTranscript: FetchTranscript = async (url) => {
    calls.push(url);
    return {
      status: opts.transcriptStatus ?? 200,
      body: opts.transcript ?? JSON.stringify(TRANSCRIPT),
    };
  };
  return { fetchPlayer, fetchTranscript, calls };
}

function makeApp(
  opts: { engine?: ReturnType<typeof strictEngine> } & FakeOpts = {},
): ReturnType<typeof makeYoutubeImportRoutes> {
  const { fetchPlayer, fetchTranscript } = fakeDeps(opts);
  return makeYoutubeImportRoutes({
    engine: opts.engine ?? strictEngine(),
    fetchPlayer,
    fetchTranscript,
    rateLimiter: allowAllLimiter,
    enforceRateLimit: false,
  });
}

function makeAppWithCalls(opts: FakeOpts = {}) {
  const deps = fakeDeps(opts);
  const app = makeYoutubeImportRoutes({
    engine: strictEngine(),
    fetchPlayer: deps.fetchPlayer,
    fetchTranscript: deps.fetchTranscript,
    rateLimiter: allowAllLimiter,
    enforceRateLimit: false,
  });
  return { app, calls: deps.calls };
}

function post(app: ReturnType<typeof makeApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
  db.prepare("DELETE FROM collections WHERE userId = 'local'").run();
  db.prepare("DELETE FROM billing_subscriptions WHERE userId = 'local'").run();
});
afterEach(() => {
  db.prepare("DELETE FROM lessons WHERE userId = 'local'").run();
  db.prepare("DELETE FROM collections WHERE userId = 'local'").run();
});

describe('POST /resolve', () => {
  test('lists caption tracks with provenance', async () => {
    const app = makeApp();
    const res = await post(app, '/resolve', { url: VIDEO_URL });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      videoId: 'vid00000001',
      title: 'Learning Afrikaans',
      channel: 'Taalkanaal',
    });
    expect(body.tracks).toEqual([
      { languageCode: 'af', languageName: 'Afrikaans', kind: 'standard' },
      { languageCode: 'af', languageName: 'Afrikaans (auto-generated)', kind: 'asr' },
    ]);
    // Internal baseUrl is never leaked to the client.
    expect(JSON.stringify(body)).not.toContain('timedtext');
  });

  test('rejects an invalid URL', async () => {
    const res = await post(makeApp(), '/resolve', { url: 'https://example.com/foo' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_URL' });
  });

  test('reports NO_CAPTIONS for a video without captions', async () => {
    const res = await post(makeApp({ player: NO_CAPTIONS_PLAYER }), '/resolve', { url: VIDEO_URL });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'NO_CAPTIONS' });
  });

  test('maps an upstream non-200 to FETCH_FAILED', async () => {
    const res = await post(makeApp({ playerStatus: 429 }), '/resolve', { url: VIDEO_URL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'FETCH_FAILED' });
  });
});

describe('POST / (import)', () => {
  test('imports the chosen track as a timestamped transcript lesson', async () => {
    const { app, calls } = makeAppWithCalls();
    const res = await post(app, '/', {
      url: VIDEO_URL,
      languageCode: 'af',
      kind: 'standard',
      language: 'af',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      segmentCount: 2,
      captionLanguage: 'af',
      captionKind: 'standard',
      title: 'Learning Afrikaans',
    });

    const lesson = db
      .prepare('SELECT * FROM lessons WHERE id = ? AND userId = ?')
      .get(body.lessonId, 'local') as LessonRow;
    expect(lesson.sourceType).toBe('youtube');
    expect(lesson.textContent).toBe('Die kat sit\nop die mat');
    expect(JSON.parse(lesson.segments!)).toEqual([
      { start: 0, end: 2, text: 'Die kat sit' },
      { start: 2, end: 4, text: 'op die mat' },
    ]);
    const meta = JSON.parse(lesson.sourceMeta!);
    expect(meta).toMatchObject({
      videoId: 'vid00000001',
      sourceUrl: VIDEO_URL,
      captionLanguage: 'af',
      captionKind: 'standard',
      channel: 'Taalkanaal',
    });
    // Picked the creator track's timedtext, not the asr one.
    expect(calls.some((u) => u.includes('kind=asr'))).toBe(false);
    expect(calls.some((u) => u.includes('fmt=json3'))).toBe(true);
  });

  test('imports the auto-generated track when requested', async () => {
    const { app, calls } = makeAppWithCalls();
    const res = await post(app, '/', {
      url: VIDEO_URL,
      languageCode: 'af',
      kind: 'asr',
    });
    expect(res.status).toBe(200);
    expect(calls.some((u) => u.includes('kind=asr'))).toBe(true);
  });

  test('422 when the transcript body is empty', async () => {
    const app = makeApp({ transcript: JSON.stringify({ events: [] }) });
    const res = await post(app, '/', {
      url: VIDEO_URL,
      languageCode: 'af',
      kind: 'standard',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'NO_CAPTIONS' });
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE userId = 'local'").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  test('requires a languageCode', async () => {
    const res = await post(makeApp(), '/', { url: VIDEO_URL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_URL' });
  });

  test('enforces the lesson plan limit without leaving orphan rows', async () => {
    const app = makeApp({ engine: strictEngine({ maxLessons: 0 }) });
    const res = await post(app, '/', { url: VIDEO_URL, languageCode: 'af', kind: 'standard' });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'plan_limit', metric: 'maxLessons' });
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM collections WHERE userId = 'local'").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
});
