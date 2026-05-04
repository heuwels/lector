import { NextRequest, NextResponse } from 'next/server';
import { resolveLanguage } from '@/lib/server/active-language';
import { getLanguageConfig } from '@/lib/languages';

// Google Cloud TTS API endpoint
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

export async function POST(request: NextRequest) {
  try {
    const { text, rate = 0.9, language } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Get API key from environment
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Google Cloud API key not configured', fallback: true },
        { status: 503 }
      );
    }

    const lang = resolveLanguage(language);
    const langConfig = getLanguageConfig(lang);

    // Prepare the request to Google Cloud TTS
    const synthesizeRequest: SynthesizeRequest = {
      input: { text },
      voice: {
        languageCode: langConfig.ttsCode,
        name: langConfig.ttsVoice,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.25, Math.min(4.0, rate)), // Google's range is 0.25-4.0
        pitch: 0, // Default pitch
      },
    };

    const response = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(synthesizeRequest),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Google TTS error:', error);

      // Return fallback flag so client can use browser TTS
      return NextResponse.json(
        { error: error.error?.message || 'TTS API error', fallback: true },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Google returns base64-encoded audio
    if (!data.audioContent) {
      return NextResponse.json(
        { error: 'No audio content returned', fallback: true },
        { status: 500 }
      );
    }

    // Return the audio as base64
    return NextResponse.json({
      audioContent: data.audioContent,
      contentType: 'audio/mp3',
    });

  } catch (error) {
    console.error('TTS route error:', error);
    return NextResponse.json(
      { error: 'Internal server error', fallback: true },
      { status: 500 }
    );
  }
}
