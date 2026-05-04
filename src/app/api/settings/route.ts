import { NextRequest, NextResponse } from 'next/server';
import { db, SettingRow } from '@/lib/server/database';

const SENSITIVE_KEYS = new Set(['anthropicApiKey', 'claudeOauthToken']);

// GET /api/settings - Get all settings
export async function GET() {
  const settings = db.prepare('SELECT * FROM settings').all() as SettingRow[];
  const result: Record<string, unknown> = {};
  for (const s of settings) {
    if (SENSITIVE_KEYS.has(s.key)) {
      result[s.key] = true;
      continue;
    }
    try {
      result[s.key] = JSON.parse(s.value);
    } catch {
      result[s.key] = s.value;
    }
  }
  return NextResponse.json(result);
}

// PUT /api/settings - Bulk update settings
export async function PUT(request: NextRequest) {
  const body = await request.json();

  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const transaction = db.transaction((entries: Array<[string, unknown]>) => {
    for (const [key, value] of entries) {
      stmt.run(key, JSON.stringify(value));
    }
  });

  transaction(Object.entries(body));

  return NextResponse.json({ success: true });
}
