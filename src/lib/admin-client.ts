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
  plan: 'free' | 'cloud' | 'plus' | null;
  status: string;
  entitled: boolean;
  compedPlan: 'cloud' | 'plus' | null;
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
    dayPeriod: string;
    llmRequests: number;
    ttsChars: number;
    journalWords: number;
    wordGlossesPerMonth: number;
    phraseTranslationsPerDay: number;
    contextTranslationsPerDay: number;
    tracked: boolean;
  };
}

export interface AdminSummary {
  users: number;
  verified: number;
  subscribers: number;
  freeAccounts: number;
  suspended: number;
  byPlan: Record<string, number>;
  byStatus: Record<string, number>;
  period: string;
  dayPeriod: string;
  usageTotals: {
    llmRequests: number;
    ttsChars: number;
    journalWords: number;
    wordGlossesPerMonth: number;
    phraseTranslationsPerDay: number;
    contextTranslationsPerDay: number;
  };
  freeUsageTotals: {
    wordGlossesPerMonth: number;
    phraseTranslationsPerDay: number;
    contextTranslationsPerDay: number;
  };
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

/** Grant a complimentary membership at a tier — the account bypasses the
 *  subscription gate and (once #222 lands) gets that plan's limits/models. */
export async function compUser(id: string, plan: 'cloud' | 'plus', reason: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/comp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, reason }),
  });
  if (!res.ok) throw new Error(`comp failed (${res.status})`);
}

/** Revoke complimentary access — the account is billed normally again. */
export async function uncompUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/uncomp`, { method: 'POST' });
  if (!res.ok) throw new Error(`uncomp failed (${res.status})`);
}

async function action(id: string, verb: string, label: string): Promise<void> {
  const res = await apiFetch(`/api/admin/users/${id}/${verb}`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${label} failed (${res.status})`);
  }
}

/** Clear the account's two-factor auth so it can re-enrol. */
export const resetMfa = (id: string) => action(id, 'reset-mfa', 'MFA reset');
/** Send the account a password-reset email. */
export const sendPasswordReset = (id: string) => action(id, 'password-reset', 'Password reset');
/** Re-send the verification email to an unverified account. */
export const resendVerification = (id: string) =>
  action(id, 'resend-verification', 'Resend verification');
/** Force-mark the account's email verified. */
export const forceVerify = (id: string) => action(id, 'verify', 'Verify');
/** Sign the account out of every session. */
export const revokeSessions = (id: string) => action(id, 'revoke-sessions', 'Revoke sessions');

export interface AdminAuditEntry {
  id: number;
  actorEmail: string | null;
  action: string;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
}

export async function getAuditLog(): Promise<AdminAuditEntry[]> {
  const res = await apiFetch('/api/admin/audit');
  if (!res.ok) throw new Error(`audit log failed (${res.status})`);
  return (await res.json()).entries as AdminAuditEntry[];
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
