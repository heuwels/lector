import { Hono } from 'hono';
import { resolveLanguage } from '../lib/active-language';
import { getLanguageConfig } from '../lib/languages';

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

const app = new Hono();

// POST /api/tts
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

    const lang = resolveLanguage(language);
    const langConfig = getLanguageConfig(lang);

    const synthesizeRequest = {
      input: { text },
      voice: {
        languageCode: langConfig.ttsCode,
        name: langConfig.ttsVoice,
      },
      audioConfig: {
        audioEncoding: 'MP3' as const,
        speakingRate: Math.max(0.25, Math.min(4.0, rate)),
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
      return c.json(
        { error: (error as Record<string, Record<string, string>>).error?.message || 'TTS API error', fallback: true },
        response.status as 400 | 401 | 403 | 500
      );
    }

    const data = await response.json();

    if (!data.audioContent) {
      return c.json({ error: 'No audio content returned', fallback: true }, 500);
    }

    return c.json({ audioContent: data.audioContent, contentType: 'audio/mp3' });
  } catch (error) {
    console.error('TTS route error:', error);
    return c.json({ error: 'Internal server error', fallback: true }, 500);
  }
});

export default app;
