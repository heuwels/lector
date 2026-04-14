import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3457';

export async function GET() {
  try {
    const response = await fetch(`${API_URL}/api/llm-status`);
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: 'Cannot reach API server' }, { status: 502 });
  }
}
