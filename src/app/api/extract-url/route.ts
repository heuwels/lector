import { proxyToApi } from '@/lib/server/api-proxy';

/**
 * Response contract for an extracted article, consumed by the WebImportModal
 * client components. Kept co-located with the route even though the work now
 * happens in the Hono API (api/src/routes/extract-url.ts).
 */
export interface ExtractedArticle {
  title: string;
  author: string | null;
  content: string;
  siteName: string | null;
  excerpt: string | null;
  wordCount: number;
}

// POST /api/extract-url — proxied to the Hono API (api/src/routes/extract-url.ts).
export const POST = proxyToApi;
