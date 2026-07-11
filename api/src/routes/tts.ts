import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getLanguageConfig } from '../lib/languages';
import { entitlements, planLimitResponse, type UsageReservation } from '../lib/entitlements';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const MAX_TTS_BODY_BYTES = 32 * 1024;
// Google Cloud TTS caps SynthesisInput content at 5,000 UTF-8 bytes. Reject
// locally before reserving quota or paying for an upstream request.
const MAX_TTS_TEXT_BYTES = 5_000;

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

const app = new Hono();

// POST /api/tts — synthesize speech via Google Cloud TTS, returned as base64.
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

      const lang = resolveLanguage(language, userId);
      const langConfig = getLanguageConfig(lang);

      const synthesizeRequest: SynthesizeRequest = {
        input: { text },
        voice: {
          languageCode: langConfig.ttsCode,
          name: langConfig.ttsVoice,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.max(0.25, Math.min(4.0, rate)), // Google's range is 0.25–4.0
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
