import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { resolveLanguage } from '../lib/active-language';
import { getCurrentUserId } from '../lib/user';
import { getLanguageConfig } from '../lib/languages';
import { entitlements, planLimitResponse } from '../lib/entitlements';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

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
app.post('/', async (c) => {
  try {
    const { text, rate = 0.9, language } = await c.req.json();

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'Text is required' }, 400);
    }

    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'Google Cloud API key not configured', fallback: true }, 503);
    }

    const userId = getCurrentUserId(c);
    // Managed-key TTS metering (#222), by synthesized characters — checked
    // before the Google call, recorded only on success. The client's browser
    // TTS fallback remains free, so over-limit still speaks.
    const ttsVerdict = entitlements.checkLimit(userId, 'ttsCharsPerMonth', text.length);
    if (!ttsVerdict.allowed) return planLimitResponse(c, ttsVerdict);

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

    entitlements.recordUsage(userId, 'ttsCharsPerMonth', text.length);
    return c.json({ audioContent: data.audioContent, contentType: 'audio/mp3' });
  } catch (error) {
    console.error('TTS route error:', error);
    return c.json({ error: 'Internal server error', fallback: true }, 500);
  }
});

export default app;
