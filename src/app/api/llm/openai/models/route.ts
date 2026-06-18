import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3457';

// POST /api/llm/openai/models — proxies to the Hono API which calls the configured
// OpenAI-compatible endpoint's /v1/models.
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const response = await fetch(`${API_URL}/api/llm/openai/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Model list proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
