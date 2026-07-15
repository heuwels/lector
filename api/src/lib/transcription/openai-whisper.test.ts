import '../../test-guard';
import { afterAll, describe, expect, test } from 'bun:test';
import { OpenAIWhisperProvider } from './openai-whisper';

// A tiny OpenAI-compatible stub — the provider only needs the two endpoints.
let lastRequest: { model: string | null; language: string | null; format: string | null } | null =
  null;
let responseBody: unknown = {};
let responseStatus = 200;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/v1/models') return Response.json({ data: [] });
    if (url.pathname === '/v1/audio/transcriptions') {
      const form = await req.formData();
      lastRequest = {
        model: form.get('model') as string | null,
        language: form.get('language') as string | null,
        format: form.get('response_format') as string | null,
      };
      return Response.json(responseBody as Record<string, unknown>, { status: responseStatus });
    }
    return new Response('not found', { status: 404 });
  },
});
afterAll(() => server.stop());

function provider() {
  return new OpenAIWhisperProvider({
    baseUrl: `http://localhost:${server.port}`,
    model: 'whisper-1',
  });
}

const AUDIO = new Blob([new Uint8Array([1, 2, 3])]);

describe('OpenAIWhisperProvider', () => {
  test('sends verbose_json + language hint and maps segments to ms', async () => {
    responseStatus = 200;
    responseBody = {
      text: ' Goeie môre.  Welkom. ',
      duration: 4.25,
      segments: [
        { id: 0, start: 0, end: 2.004, text: ' Goeie môre.' },
        { id: 1, start: 2.004, end: 4.25, text: ' Welkom. ' },
        { id: 2, start: 4.25, end: 4.3, text: '   ' }, // silence-only: dropped
      ],
    };

    const result = await provider().transcribe(AUDIO, { language: 'af', filename: 'clip.mp3' });

    expect(lastRequest).toEqual({ model: 'whisper-1', language: 'af', format: 'verbose_json' });
    expect(result.text).toBe('Goeie môre.  Welkom.');
    expect(result.durationMs).toBe(4250);
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 2004, text: 'Goeie môre.' },
      { startMs: 2004, endMs: 4250, text: 'Welkom.' },
    ]);
  });

  test('joins segment text when the top-level text is missing', async () => {
    responseStatus = 200;
    responseBody = {
      segments: [
        { start: 0, end: 1, text: 'Een.' },
        { start: 1, end: 2, text: 'Twee.' },
      ],
    };
    const result = await provider().transcribe(AUDIO, { language: 'af', filename: 'clip.mp3' });
    expect(result.text).toBe('Een. Twee.');
  });

  test('throws with the provider status on an error response', async () => {
    responseStatus = 503;
    responseBody = { error: 'model loading' };
    await expect(
      provider().transcribe(AUDIO, { language: 'af', filename: 'clip.mp3' }),
    ).rejects.toThrow('ASR provider returned 503');
  });

  test('throws on an empty transcript', async () => {
    responseStatus = 200;
    responseBody = { text: '  ', segments: [] };
    await expect(
      provider().transcribe(AUDIO, { language: 'af', filename: 'clip.mp3' }),
    ).rejects.toThrow('empty transcript');
  });

  test('healthCheck reports reachability', async () => {
    expect(await provider().healthCheck()).toEqual({ ok: true });
    const dead = new OpenAIWhisperProvider({ baseUrl: 'http://localhost:1', timeoutMs: 500 });
    expect((await dead.healthCheck()).ok).toBe(false);
  });
});
