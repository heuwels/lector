import { db } from '../db';

/** Parse Better Auth `createdAt` (ISO, Date, ms, or unix seconds). Null if unknown. */
export function createdAtMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      if (!Number.isFinite(asNumber)) return null;
      return asNumber < 1e11 ? asNumber * 1000 : asNumber;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Null when the account or the Better Auth `user` table does not exist. */
export function getUserCreatedAtMs(userId: string): number | null {
  try {
    const row = db.prepare('SELECT createdAt FROM user WHERE id = ?').get(userId) as
      | { createdAt: unknown }
      | undefined;
    return row ? createdAtMs(row.createdAt) : null;
  } catch {
    return null;
  }
}
