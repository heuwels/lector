import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3457';

// POST /api/llm/lmstudio/load — proxies to the Hono API which calls LM Studio's /api/v1/models/load.
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const response = await fetch(`${API_URL}/api/llm/lmstudio/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('LM Studio load proxy error:', error);
    return NextResponse.json({ error: 'Failed to load model' }, { status: 500 });
  }
}
