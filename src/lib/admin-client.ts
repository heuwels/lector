/**
 * Client data layer for the admin dashboard (#221). Thin wrappers over the
 * /api/admin endpoints (server-enforced by requireAdmin). A non-admin never
 * reaches these — the nav link is hidden and the page renders "not authorized"
 * on a 403.
 */
import { apiFetch } from './api-base';

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string | null;
  plan: 'cloud' | 'plus' | null;
  status: string;
  entitled: boolean;
  currentPeriodEnd: string | null;
  suspended: boolean;
  suspendedReason: string | null;
  lastActiveAt: string | null;
  library: {
    collections: number;
    lessons: number;
    vocab: number;
    knownWords: number;
    storageBytes: number;
  };
  usage: {
    period: string;
    llmRequests: number;
    ttsChars: number;
    journalWords: number;
    tracked: boolean;
  };
}

export interface AdminSummary {
  users: number;
  verified: number;
  subscribers: number;
  suspended: number;
  byPlan: Record<string, number>;
  byStatus: Record<string, number>;
  period: string;
  usageTotals: { llmRequests: number; ttsChars: number; journalWords: number };
  usageTracked: boolean;
}

/** True if the caller is an admin (200 from the gated probe), false on 403/404. */
export async function checkAdminAccess(): Promise<boolean> {
  const res = await apiFetch('/api/admin/access');
  return res.ok;
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const res = await apiFetch('/api/admin/summary');
  if (!res.ok) throw new Error(`admin summary failed (${res.status})`);
  return res.json();
}

export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const res = await apiFetch('/api/admin/users');
  if (!res.ok) throw new Error(`admin users failed (${res.status})`);
  return (await res.json()).users as AdminUserRow[];
}

export async function suspendUser(id: string, reason: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/suspend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `suspend failed (${res.status})`);
  }
}

export async function restoreUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/restore`, { method: 'POST' });
  if (!res.ok) throw new Error(`restore failed (${res.status})`);
}

/** Fetch a user's full export and trigger a JSON file download in the browser. */
export async function exportUser(id: string, email: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/export`);
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `lector-export-${email.replace(/[^a-z0-9]+/gi, '-')}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
