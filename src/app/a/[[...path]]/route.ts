import { handleAnalytics } from '@/lib/analytics-forward';

function unavailable(): Response | null {
  if (process.env.LECTOR_MODE === 'cloud') return null;
  return new Response('not found', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

export function GET(request: Request): Promise<Response> | Response {
  return unavailable() ?? handleAnalytics(request, process.env);
}

export function POST(request: Request): Promise<Response> | Response {
  return unavailable() ?? handleAnalytics(request, process.env);
}
