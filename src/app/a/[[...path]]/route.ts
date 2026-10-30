import { handleAnalytics, type AnalyticsEnv } from '@/lib/analytics-forward';

function unavailable(): Response | null {
  if (process.env.LECTOR_MODE === 'cloud') return null;
  return new Response('not found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

// ProcessEnv is an index signature. AnalyticsEnv is a named pair, so copy the two values.
function analyticsEnv(): AnalyticsEnv {
  return {
    ANALYTICS_FORWARDING_URL: process.env.ANALYTICS_FORWARDING_URL,
    ANALYTICS_WEBSITE_ID: process.env.ANALYTICS_WEBSITE_ID,
  };
}

export function GET(request: Request): Promise<Response> | Response {
  return unavailable() ?? handleAnalytics(request, analyticsEnv());
}

export function POST(request: Request): Promise<Response> | Response {
  return unavailable() ?? handleAnalytics(request, analyticsEnv());
}
