// YouTube transcript acquisition (#334).
//
// Implementation/legal spike outcome: the only transcript path this MVP uses is
// the *public* one YouTube already serves to an anonymous watch-page visitor —
// the `captionTracks` list embedded in `ytInitialPlayerResponse`, and the
// per-track `timedtext` endpoint fetched as `fmt=json3`. We never sign in,
// never send cookies, never bypass an access control, and never download the
// audio/video stream. A video with captions disabled, or one that is
// private/age-restricted (its watch page omits `captionTracks`), simply yields
// NO_CAPTIONS — we don't try to route around it.
//
// Everything here is pure (HTML/JSON in, data out) so it unit-tests without a
// network. The route (routes/youtube-import.ts) injects the fetcher, and only
// the route ever touches the wire — via `safeFetch`, which enforces the SSRF
// allowlist on every hop.

export type CaptionKind = 'standard' | 'asr';

export interface CaptionTrack {
  /** BCP-47-ish language code from YouTube, e.g. 'en', 'af', 'pt-BR'. */
  languageCode: string;
  /** Human label, e.g. 'English', 'Afrikaans (auto-generated)'. */
  languageName: string;
  /** 'asr' = auto-generated (speech recognition); 'standard' = creator/uploaded. */
  kind: CaptionKind;
  /** The timedtext base URL YouTube gives for this track. */
  baseUrl: string;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
}

export interface TranscriptSegment {
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds from the start of the video (start + cue duration). */
  end: number;
  text: string;
}

/**
 * Extract the 11-char video id from any of the URL shapes a user is likely to
 * paste. Returns null for anything that isn't recognisably a YouTube video URL
 * (the caller turns that into an INVALID_URL error).
 */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Allow a bare id (exactly 11 of the id alphabet).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isId = (v: string | null): v is string => !!v && /^[A-Za-z0-9_-]{11}$/.test(v);

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isId(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (isId(v)) return v;
    // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
    const m = url.pathname.match(/^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    return null;
  }

  return null;
}

/** The canonical watch URL we fetch and store as the source. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// InnerTube — YouTube's own public, unauthenticated player API. Spike outcome
// (#334): the historical path (parse `captionTracks` from watch-page HTML, then
// GET the `timedtext` baseUrl) still lists tracks but now returns an EMPTY body
// for anonymous server requests — YouTube gates it behind a player-generated
// proof-of-origin token. The InnerTube `player` endpoint with a MOBILE client
// context still returns caption baseUrls that serve the transcript, so that's
// what we use. This is a public API key baked into YouTube's own web client; we
// send no credentials, bypass no access control, and never touch the media
// stream. The IOS client returns json3 (our parser's format) directly.
const INNERTUBE_URL =
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_IOS_UA =
  'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)';

/** The InnerTube `player` request (POST) for a video's metadata + captions. */
export function buildInnerTubePlayerRequest(videoId: string): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: INNERTUBE_URL,
    headers: { 'Content-Type': 'application/json', 'User-Agent': INNERTUBE_IOS_UA },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '20.10.4',
          deviceModel: 'iPhone16,2',
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  };
}

/**
 * Pull a top-level JSON object out of watch-page HTML that follows a marker like
 * `ytInitialPlayerResponse = `. Brace-matched (string/escape aware) rather than
 * regex, so nested objects and braces inside strings don't truncate it.
 */
export function extractJsonAfterMarker(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;

  let i = markerIndex + marker.length;
  // Skip whitespace and an optional '=' between the marker and the object.
  while (i < html.length && html[i] !== '{') {
    const ch = html[i];
    if (ch !== ' ' && ch !== '=' && ch !== '\n' && ch !== '\r' && ch !== '\t') break;
    i++;
  }
  if (html[i] !== '{') return null;

  const start = i;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonText = html.slice(start, i + 1);
        try {
          return JSON.parse(jsonText);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Parse the embedded player response from watch-page HTML. */
export function extractPlayerResponse(html: string): unknown | null {
  return (
    extractJsonAfterMarker(html, 'ytInitialPlayerResponse') ??
    extractJsonAfterMarker(html, '"playerResponse":')
  );
}

function readName(name: unknown): string {
  if (name && typeof name === 'object') {
    const obj = name as Record<string, unknown>;
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    if (Array.isArray(obj.runs)) {
      return obj.runs
        .map((r) =>
          r && typeof r === 'object' ? String((r as Record<string, unknown>).text ?? '') : '',
        )
        .join('');
    }
  }
  return '';
}

/** Pull the caption tracks out of a parsed player response. */
export function extractCaptionTracks(player: unknown): CaptionTrack[] {
  const tracks = (
    player as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } };
    }
  )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];

  const out: CaptionTrack[] = [];
  for (const raw of tracks) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const baseUrl = typeof t.baseUrl === 'string' ? t.baseUrl : '';
    const languageCode = typeof t.languageCode === 'string' ? t.languageCode : '';
    if (!baseUrl || !languageCode) continue;
    const kind: CaptionKind = t.kind === 'asr' ? 'asr' : 'standard';
    const label = readName(t.name) || languageCode;
    // YouTube's own asr label often already reads "English (auto-generated)";
    // only add the marker when it isn't already there, so we never double it up.
    const languageName =
      kind === 'asr' && !/auto-generated/i.test(label) ? `${label} (auto-generated)` : label;
    out.push({ languageCode, languageName, kind, baseUrl });
  }
  return out;
}

/** Pull title/channel out of a parsed player response. */
export function extractVideoMeta(player: unknown, videoId: string): VideoMeta {
  const details = (player as { videoDetails?: { title?: unknown; author?: unknown } })
    ?.videoDetails;
  return {
    videoId,
    title: typeof details?.title === 'string' && details.title ? details.title : videoId,
    channel: typeof details?.author === 'string' ? details.author : '',
  };
}

/**
 * Force the json3 caption format on a track's baseUrl (dropping any existing
 * fmt so we always get the timed-events JSON we know how to parse).
 */
export function toJson3Url(baseUrl: string): string {
  try {
    const url = new URL(baseUrl, 'https://www.youtube.com');
    url.searchParams.set('fmt', 'json3');
    return url.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl.replace(/([?&])fmt=[^&]*/g, '$1').replace(/[?&]$/, '')}${sep}fmt=json3`;
  }
}

/**
 * Parse a json3 timedtext body into ordered segments. Each cue event carries
 * `tStartMs`, `dDurationMs`, and `segs[].utf8`; we join the segs, trim, and
 * drop empty/whitespace-only cues (music/newline markers).
 */
export function parseJson3Transcript(body: string | unknown): TranscriptSegment[] {
  let data: unknown = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch {
      return [];
    }
  }
  const events = (data as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];

  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as Record<string, unknown>;
    const segs = e.segs;
    if (!Array.isArray(segs)) continue;
    const text = segs
      .map((s) =>
        s && typeof s === 'object' ? String((s as Record<string, unknown>).utf8 ?? '') : '',
      )
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const startMs = typeof e.tStartMs === 'number' ? e.tStartMs : 0;
    const durMs = typeof e.dDurationMs === 'number' ? e.dDurationMs : 0;
    segments.push({
      start: startMs / 1000,
      end: (startMs + durMs) / 1000,
      text,
    });
  }
  return segments;
}

/** Flatten segments into readable text (one cue per line) for the lesson body. */
export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}

/** mm:ss (or h:mm:ss) label for a second offset. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** A watch URL that opens the player at a given second. */
export function watchUrlAt(videoId: string, seconds: number): string {
  return `${watchUrl(videoId)}&t=${Math.max(0, Math.floor(seconds))}s`;
}
