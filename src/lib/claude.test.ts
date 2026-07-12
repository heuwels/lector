import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateGloss } from './claude';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateGloss', () => {
  it('uses the cheap gloss endpoint and returns only the translation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response('house');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateGloss('huis', 'Dit is my huis.')).resolves.toEqual({
      translation: 'house',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3457/api/translate/gloss');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      word: 'huis',
      sentence: 'Dit is my huis.',
    });
    expect(body).not.toHaveProperty('type');
  });
});
