import type { ExtractedArticle } from '@/app/api/extract-url/route';

export type ExtractResult = { ok: true; data: ExtractedArticle } | { ok: false; message: string };

export async function extractArticle(url: string): Promise<ExtractResult> {
  try {
    const response = await fetch('/api/extract-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { ok: false, message: data.error || 'Failed to extract article' };
    }

    return { ok: true, data };
  } catch (error) {
    console.error('Error extracting URL:', error);
    return { ok: false, message: 'Network error. Check your connection.' };
  }
}
