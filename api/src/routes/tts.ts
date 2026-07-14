import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getLanguageConfig } from '../lib/languages';
import { entitlements, planLimitResponse, type UsageReservation } from '../lib/entitlements';
import { getTtsCache, ttsCacheKey } from '../lib/tts-cache';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const MAX_TTS_BODY_BYTES = 32 * 1024;
// Google Cloud TTS caps SynthesisInput content at 5,000 UTF-8 bytes. Reject
// locally before reserving quota or paying for an upstream request.
const MAX_TTS_TEXT_BYTES = 5_000;

// eSpeak NG's default speaking rate is 175 words-per-minute; the client's
// rate multiplier maps onto it (app default 0.9× ≈ 158 wpm), clamped to
// espeak's sensible range.
const ESPEAK_BASE_WPM = 175;
const ESPEAK_MIN_WPM = 80;
const ESPEAK_MAX_WPM = 450;

interface SynthesizeRequest {
  input: { text: string };
  voice: {
    languageCode: string;
    name?: string;
    ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  };
  audioConfig: {
    audioEncoding: 'MP3' | 'LINEAR16' | 'OGG_OPUS';
    speakingRate?: number;
    pitch?: number;
  };
}

/**
 * Synthesize via self-hosted eSpeak NG (#307 §3.2c) — the only
 * commercially-usable Esperanto TTS, baked into the API image (Dockerfile
 * runner stage `apk add espeak-ng`). Invoked as an arm's-length subprocess:
 * text goes in via stdin (no shell, no argv-length limits), WAV comes out on
 * stdout. No cache, no key, no metering — formant synthesis runs hundreds×
 * realtime on one CPU core, so regenerating is cheaper than storing.
 *
 * eSpeak needs no per-language voice field: its Esperanto voice id is just
 * `eo`, so the pack's `code` serves until some language diverges.
 */
async function synthesizeWithEspeak(text: string, voice: string, rate: number): Promise<string> {
  const wpm = Math.round(
    Math.min(ESPEAK_MAX_WPM, Math.max(ESPEAK_MIN_WPM, ESPEAK_BASE_WPM * rate)),
  );
  const proc = Bun.spawn(
    // -b 1: stdin is UTF-8. --stdin + --stdout: text in, WAV out.
    ['espeak-ng', '-v', voice, '-s', String(wpm), '-b', '1', '--stdin', '--stdout'],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  proc.stdin.write(text);
  await proc.stdin.end();

  const [wav, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0 || wav.byteLength === 0) {
    throw new Error(
      `espeak-ng exited ${exitCode} with ${wav.byteLength} bytes${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
    );
  }
  return Buffer.from(wav).toString('base64');
}

const app = new Hono();

// POST /api/tts — synthesize speech, returned as base64. Dispatches on the
// language pack's pronunciation capability (#307 §3.2): Google Cloud TTS for
// the national-language packs, self-hosted eSpeak NG for Esperanto, and an
// explicit no-audio answer for `audio: 'none'` languages (disputed or
// reconstructed pronunciation), which must NOT trigger the client's
// browser-voice fallback.
app.post(
  '/',
  bodyLimit({
    maxSize: MAX_TTS_BODY_BYTES,
    onError: (c) => c.json({ error: 'TTS request is too large', fallback: true }, 413),
  }),
  async (c) => {
    const userId = getCurrentUserId(c);
    let reservation: UsageReservation | null = null;
    let earned = false;
    try {
      const { text, rate = 0.9, language } = await c.req.json();

      if (!text || typeof text !== 'string') {
        return c.json({ error: 'Text is required' }, 400);
      }
      if (new TextEncoder().encode(text).byteLength > MAX_TTS_TEXT_BYTES) {
        return c.json({ error: 'Text is too long (max 5,000 bytes)', fallback: true }, 400);
      }

      const lang = resolveLanguage(language, userId);
      const langConfig = getLanguageConfig(lang);
      const audio = langConfig.pronunciation.audio;

      if (audio === 'none') {
        // No `fallback: true`: nothing should speak this language (#307 §3.2a).
        return c.json({ error: 'This language has no synthesized voice', noAudio: true }, 404);
      }

      // Engine dispatch: packs declare their engines best-first. Today each
      // pack declares a single engine (national languages `['google']`, eo
      // `['espeak']`); the ordered-list form is the seam the §3.2c plan
      // matrix (espeak as the free-tier engine everywhere) later slots into.
      if (!audio.includes('google')) {
        // eSpeak: unmetered on every tier (zero marginal cost — #307 §3.2c)
        // and uncached (regenerating is cheaper than storing). On failure
        // there is deliberately no `fallback: true` — an espeak-only language
        // has no browser voice to fall back to, and mis-speaking in a
        // wrong-language voice is the failure mode this seam exists to kill.
        const rateNum = typeof rate === 'number' ? rate : 0.9;
        try {
          const audioContent = await synthesizeWithEspeak(text, langConfig.code, rateNum);
          return c.json({ audioContent, contentType: 'audio/wav' });
        } catch (err) {
          console.error('eSpeak TTS error:', err);
          return c.json({ error: 'Speech synthesis failed', noAudio: true }, 500);
        }
      }

      // Google path. A pack that lists 'google' must carry the voice fields.
      if (!langConfig.ttsCode || !langConfig.ttsVoice) {
        console.error(`Language "${lang}" declares Google TTS but has no ttsCode/ttsVoice`);
        return c.json({ error: 'TTS voice not configured for this language', fallback: true }, 503);
      }

      const speakingRate = Math.max(0.25, Math.min(4.0, rate)); // Google's range is 0.25–4.0

      // Cache first (#226): identical (language, voice, rate, text) always
      // renders identical audio, so a hit skips Google entirely — checked
      // before the key gate (cached audio plays even keyless) and before
      // metering, since ttsCharsPerMonth meters *synthesized* characters and a
      // hit synthesizes nothing. This is what makes read-along affordable:
      // re-reads and cross-user vocab overlap stop billing.
      const cache = getTtsCache();
      const cacheKey = ttsCacheKey({
        language: lang,
        voice: `${langConfig.ttsCode}:${langConfig.ttsVoice}`,
        rate: speakingRate,
        text,
      });
      const hit = await cache.get(cacheKey);
      if (hit) {
        return c.json({
          audioContent: Buffer.from(hit).toString('base64'),
          contentType: 'audio/mp3',
          cached: true,
        });
      }

      const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
      if (!apiKey) {
        return c.json({ error: 'Google Cloud API key not configured', fallback: true }, 503);
      }

      // Managed-key TTS metering (#222), by synthesized characters. Reserved
      // before the Google call and refunded (via `finally`) on any non-success
      // exit, so a failed/over-cap synth never bills and two concurrent requests
      // can't both slip past the cap (#222 review). The client's browser TTS
      // fallback stays free, so over-limit still speaks.
      const ttsVerdict = entitlements.reserve(userId, 'ttsCharsPerMonth', text.length);
      if (!ttsVerdict.allowed) return planLimitResponse(c, ttsVerdict);
      reservation = ttsVerdict.reservation;

      const synthesizeRequest: SynthesizeRequest = {
        input: { text },
        voice: {
          languageCode: langConfig.ttsCode,
          name: langConfig.ttsVoice,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate,
          pitch: 0,
        },
      };

      const response = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(synthesizeRequest),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Google TTS error:', error);
        // Return fallback flag so the client can use browser TTS.
        return c.json(
          { error: error.error?.message || 'TTS API error', fallback: true },
          response.status as ContentfulStatusCode,
        );
      }

      const data = await response.json();

      if (!data.audioContent) {
        return c.json({ error: 'No audio content returned', fallback: true }, 500);
      }

      earned = true; // Google synthesized the characters — the usage is real
      // Best-effort store (put never throws): the next request for this tuple —
      // from any user — is served from cache instead of re-billed.
      await cache.put(cacheKey, new Uint8Array(Buffer.from(data.audioContent, 'base64')));
      return c.json({ audioContent: data.audioContent, contentType: 'audio/mp3' });
    } catch (error) {
      console.error('TTS route error:', error);
      return c.json({ error: 'Internal server error', fallback: true }, 500);
    } finally {
      // Every non-success exit (fallback returns, throws) refunds the reservation.
      if (reservation && !earned) entitlements.refund(reservation);
    }
  },
);

export default app;
