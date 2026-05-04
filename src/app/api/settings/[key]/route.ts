import { NextRequest, NextResponse } from 'next/server';
import { db, SettingRow } from '@/lib/server/database';

const SENSITIVE_KEYS = new Set(['anthropicApiKey', 'claudeOauthToken']);

// GET /api/settings/[key]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;

  if (!setting) {
    return NextResponse.json(null);
  }

  if (SENSITIVE_KEYS.has(key)) {
    return NextResponse.json(true);
  }

  try {
    return NextResponse.json(JSON.parse(setting.value));
  } catch {
    return NextResponse.json(setting.value);
  }
}

// PUT /api/settings/[key]
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const body = await request.json();

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(body.value));

  return NextResponse.json({ success: true });
}

// DELETE /api/settings/[key]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  return NextResponse.json({ success: true });
}
