import { Hono } from 'hono';
import { db } from '../db';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { countWords } from '../lib/html-to-markdown';
import { normalizeText } from '../lib/languages';
import { safeFetch, readBodyCapped, SsrfError } from '../lib/safe-fetch';
import { config } from '../lib/config';
import { extractionBurstLimiter, type ExtractionBurstLimiter } from '../lib/rate-limit';
import { entitlements, planLimitResponse, type EntitlementsEngine } from '../lib/entitlements';
import { collectionMetadataBytes, lessonTextBytes } from '../lib/storage-limits';
import {
  buildInnerTubePlayerRequest,
  extractCaptionTracks,
  extractPlayabilityStatus,
  extractVideoMeta,
  parseJson3Transcript,
  parseYouTubeVideoId,
  segmentsToText,
  toJson3Url,
  watchUrl,
  type CaptionKind,
} from '../lib/youtube-transcript';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

// Cap the fetched page/transcript so a hostile response can't exhaust memory.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

// Fetched a video's player metadata (title/channel + caption tracks). Injected
// so unit tests never hit the network.
export type FetchPlayer = (videoId: string) => Promise<{ status: number; player: unknown | null }>;
// Fetched a caption track body (json3). Injected likewise.
export type FetchTranscript = (url: string) => Promise<{ status: number; body: string }>;

// Test seam (opt-in via LECTOR_YOUTUBE_FIXTURE, same spirit as
// STARTER_CONTENT_ROOT): a JSON file of the form
//   { "players": { "<videoId>": <player object> },
//     "transcripts": { "<url-substring>": "<json3 body>" } }
// lets e2e/CI drive the whole import path without live YouTube. Unset in
// production, where the InnerTube fetchers below run.
interface YoutubeFixture {
  players?: Record<string, unknown>;
  transcripts?: Record<string, string>;
}
let fixtureCache: YoutubeFixture | null | undefined;
function loadYoutubeFixtures(): YoutubeFixture | null {
  if (fixtureCache !== undefined) return fixtureCache;
  const path = process.env.LECTOR_YOUTUBE_FIXTURE;
  if (!path) {
    fixtureCache = null;
    return null;
  }
  try {
    fixtureCache = JSON.parse(readFileSync(path, 'utf8')) as YoutubeFixture;
  } catch (err) {
    console.error('[youtube-import] failed to load LECTOR_YOUTUBE_FIXTURE:', err);
    fixtureCache = null;
  }
  return fixtureCache ?? null;
}

// The real player fetch: POST YouTube's public InnerTube `player` endpoint
// through safeFetch (SSRF allowlist, re-validated per redirect hop), capped and
// UTF-8 decoded. See buildInnerTubePlayerRequest for why InnerTube rather than
// the (now token-gated) watch-page path.
async function defaultFetchPlayer(
  videoId: string,
): Promise<{ status: number; player: unknown | null }> {
  const fixtures = loadYoutubeFixtures();
  if (fixtures) {
    const player = fixtures.players?.[videoId];
    return player ? { status: 200, player } : { status: 404, player: null };
  }
  const req = buildInnerTubePlayerRequest(videoId);
  const response = await safeFetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(15000),
    maxRedirects: 5,
  });
  const bytes = await readBodyCapped(response, MAX_RESPONSE_BYTES);
  let player: unknown | null = null;
  try {
    player = JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch {
    player = null;
  }
  return { status: response.status, player };
}

// The real transcript fetch: GET the caption track baseUrl (from the player
// response) through safeFetch.
async function defaultFetchTranscript(url: string): Promise<{ status: number; body: string }> {
  const fixtures = loadYoutubeFixtures();
  if (fixtures) {
    for (const [key, body] of Object.entries(fixtures.transcripts ?? {})) {
      if (url.includes(key)) return { status: 200, body };
    }
    return { status: 404, body: '' };
  }
  const response = await safeFetch(url, {
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
    },
    signal: AbortSignal.timeout(15000),
    maxRedirects: 5,
  });
  const bytes = await readBodyCapped(response, MAX_RESPONSE_BYTES);
  return { status: response.status, body: new TextDecoder('utf-8').decode(bytes) };
}

interface YoutubeImportDeps {
  engine: EntitlementsEngine;
  fetchPlayer: FetchPlayer;
  fetchTranscript: FetchTranscript;
  rateLimiter: ExtractionBurstLimiter;
  enforceRateLimit: boolean;
}

interface ResolvedVideo {
  videoId: string;
  title: string;
  channel: string;
  tracks: Array<{
    languageCode: string;
    languageName: string;
    kind: CaptionKind;
    baseUrl: string;
  }>;
}

type ResolveErrorCode = 'INVALID_URL' | 'FETCH_FAILED' | 'NO_CAPTIONS' | 'BLOCKED';

type ResolveOutcome =
  | { ok: true; video: ResolvedVideo }
  | { ok: false; code: ResolveErrorCode; message: string };

// Fetch the video's InnerTube player response and pull out metadata + caption
// tracks. Shared by /resolve (list languages) and /import (pick the chosen one).
async function resolveVideo(fetchPlayer: FetchPlayer, url: string): Promise<ResolveOutcome> {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: "That doesn't look like a YouTube video URL.",
    };
  }

  let result: { status: number; player: unknown | null };
  try {
    result = await fetchPlayer(videoId);
  } catch (err) {
    if (err instanceof SsrfError) {
      return {
        ok: false,
        code: 'INVALID_URL',
        message: 'Please enter a valid, public YouTube URL.',
      };
    }
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: 'Could not reach YouTube. Check the URL and try again.',
    };
  }

  if (result.status !== 200 || !result.player) {
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: 'Could not load that video. It may be private, removed, or region-blocked.',
    };
  }

  const tracks = extractCaptionTracks(result.player);
  if (tracks.length === 0) {
    // No captions can mean two very different things. If YouTube declined the
    // request (a bot/login challenge — common on cloud/datacenter IPs, absent on
    // residential ones), say so plainly instead of blaming the video (#334).
    const play = extractPlayabilityStatus(result.player);
    if (play.status && play.status !== 'OK') {
      return {
        ok: false,
        code: 'BLOCKED',
        message:
          `YouTube declined this request${play.reason ? ` ("${play.reason}")` : ''}. ` +
          'This usually means the server’s network is being challenged rather than the ' +
          'video lacking captions — a self-hosted Lector on a home connection is unaffected.',
      };
    }
    return {
      ok: false,
      code: 'NO_CAPTIONS',
      message:
        'This video has no available transcript. Captions may be disabled, or the video may be private or age-restricted.',
    };
  }

  const meta = extractVideoMeta(result.player, videoId);
  return { ok: true, video: { videoId, title: meta.title, channel: meta.channel, tracks } };
}

const RESOLVE_ERROR_STATUS: Record<ResolveErrorCode, 400 | 422 | 502> = {
  INVALID_URL: 400,
  FETCH_FAILED: 400,
  NO_CAPTIONS: 422,
  BLOCKED: 502,
};

export function makeYoutubeImportRoutes({
  engine,
  fetchPlayer,
  fetchTranscript,
  rateLimiter,
  enforceRateLimit,
}: YoutubeImportDeps): Hono {
  const app = new Hono();

  const checkRate = (c: import('hono').Context, userId: string): boolean => {
    if (!enforceRateLimit) return true;
    return rateLimiter.tryConsume(userId, null);
  };

  // POST /api/import/youtube/resolve — list caption tracks + metadata for a URL.
  // No persistence; the modal calls this first so the user can pick a language.
  app.post('/resolve', async (c) => {
    const userId = getCurrentUserId(c);
    if (!checkRate(c, userId)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'rate_limited', code: 'RATE_LIMITED', retryAfterSeconds: 60 }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const url = (body as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url.trim()) {
      return c.json({ error: 'URL is required', code: 'INVALID_URL' }, 400);
    }

    const outcome = await resolveVideo(fetchPlayer, url.trim());
    if (!outcome.ok) {
      return c.json(
        { error: outcome.message, code: outcome.code },
        RESOLVE_ERROR_STATUS[outcome.code],
      );
    }

    // Caption provenance is surfaced to the user; the internal baseUrl is not
    // (we re-resolve the track by language on import, never trust a client URL).
    return c.json({
      videoId: outcome.video.videoId,
      title: outcome.video.title,
      channel: outcome.video.channel,
      tracks: outcome.video.tracks.map((t) => ({
        languageCode: t.languageCode,
        languageName: t.languageName,
        kind: t.kind,
      })),
    });
  });

  // POST /api/import/youtube — import the chosen caption track as a lesson.
  app.post('/', async (c) => {
    const userId = getCurrentUserId(c);
    if (!checkRate(c, userId)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'rate_limited', code: 'RATE_LIMITED', retryAfterSeconds: 60 }, 429);
    }

    const body = (await c.req.json().catch(() => null)) as {
      url?: unknown;
      languageCode?: unknown;
      kind?: unknown;
      language?: unknown;
    } | null;
    const url = body?.url;
    const wantLanguageCode = body?.languageCode;
    const wantKind: CaptionKind = body?.kind === 'asr' ? 'asr' : 'standard';
    if (typeof url !== 'string' || !url.trim()) {
      return c.json({ error: 'URL is required', code: 'INVALID_URL' }, 400);
    }
    if (typeof wantLanguageCode !== 'string' || !wantLanguageCode) {
      return c.json({ error: 'languageCode is required', code: 'INVALID_URL' }, 400);
    }

    const outcome = await resolveVideo(fetchPlayer, url.trim());
    if (!outcome.ok) {
      return c.json(
        { error: outcome.message, code: outcome.code },
        RESOLVE_ERROR_STATUS[outcome.code],
      );
    }
    const { video } = outcome;

    // Match the requested track by language + provenance; fall back to the same
    // language regardless of kind so a stale kind choice still imports something.
    const track =
      video.tracks.find((t) => t.languageCode === wantLanguageCode && t.kind === wantKind) ??
      video.tracks.find((t) => t.languageCode === wantLanguageCode);
    if (!track) {
      return c.json(
        { error: 'That caption track is no longer available.', code: 'NO_CAPTIONS' },
        422,
      );
    }

    let transcriptBody: { status: number; body: string };
    try {
      transcriptBody = await fetchTranscript(toJson3Url(track.baseUrl));
    } catch (err) {
      if (err instanceof SsrfError) {
        return c.json(
          { error: 'Please enter a valid, public YouTube URL.', code: 'INVALID_URL' },
          400,
        );
      }
      return c.json({ error: 'Could not download the transcript.', code: 'FETCH_FAILED' }, 400);
    }
    if (transcriptBody.status !== 200) {
      return c.json({ error: 'Could not download the transcript.', code: 'FETCH_FAILED' }, 400);
    }

    const segments = parseJson3Transcript(transcriptBody.body);
    if (segments.length === 0) {
      return c.json(
        { error: 'That transcript is empty or could not be parsed.', code: 'NO_CAPTIONS' },
        422,
      );
    }

    const lang = resolveLanguage(typeof body?.language === 'string' ? body.language : null, userId);
    const title = normalizeText(video.title);
    const author = normalizeText(video.channel) || 'Unknown';
    const textContent = normalizeText(segmentsToText(segments));
    const now = new Date().toISOString();
    const sourceUrl = watchUrl(video.videoId);
    const sourceMeta = JSON.stringify({
      videoId: video.videoId,
      sourceUrl,
      channel: author,
      videoTitle: video.title,
      captionLanguage: track.languageCode,
      captionLanguageName: track.languageName,
      captionKind: track.kind,
      importedAt: now,
    });
    const segmentsJson = JSON.stringify(segments);

    const collectionId = randomUUID();
    const lessonId = randomUUID();

    const insertCollection = db.prepare(`
      INSERT INTO collections (id, title, author, coverUrl, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLesson = db.prepare(`
      INSERT INTO lessons (id, collectionId, title, sortOrder, textContent, wordCount, sourceType, sourceMeta, segments, language, createdAt, lastReadAt, userId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Byte accounting includes the segments JSON (it roughly doubles the stored
    // text) so a transcript can't slip past the lesson-size entitlement.
    const lessonBytes = lessonTextBytes(textContent + segmentsJson, title);
    const verdict = engine.reserveCount(
      userId,
      [
        { metric: 'maxCollections' },
        { metric: 'maxLessons', requested: 1 },
        { metric: 'maxLessonTextBytes', requested: lessonBytes },
        { metric: 'maxLessonTextBytesTotal', requested: lessonBytes },
        {
          metric: 'maxCollectionMetadataBytes',
          requested: collectionMetadataBytes({ title, author }),
        },
      ],
      () => {
        insertCollection.run(collectionId, title, author, null, lang, now, now, userId);
        insertLesson.run(
          lessonId,
          collectionId,
          title,
          0,
          textContent,
          countWords(textContent),
          'youtube',
          sourceMeta,
          segmentsJson,
          lang,
          now,
          now,
          userId,
        );
      },
    );
    if (!verdict.allowed) return planLimitResponse(c, verdict);

    return c.json({
      collectionId,
      lessonId,
      title,
      segmentCount: segments.length,
      captionLanguage: track.languageCode,
      captionKind: track.kind,
    });
  });

  return app;
}

export default makeYoutubeImportRoutes({
  engine: entitlements,
  fetchPlayer: defaultFetchPlayer,
  fetchTranscript: defaultFetchTranscript,
  rateLimiter: extractionBurstLimiter,
  enforceRateLimit: config.mode === 'cloud',
});
