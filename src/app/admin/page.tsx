'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { useLectorMode } from '@/lib/use-env';
import {
  getAdminSummary,
  getAdminUsers,
  getAuditLog,
  suspendUser,
  restoreUser,
  compUser,
  uncompUser,
  exportUser,
  resetMfa,
  sendPasswordReset,
  resendVerification,
  forceVerify,
  revokeSessions,
  resyncPaddle,
  type AdminSummary,
  type AdminUserRow,
  type AdminAuditEntry,
} from '@/lib/admin-client';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function planBadge(row: AdminUserRow): { label: string; className: string } {
  if (row.suspended) return { label: 'suspended', className: 'bg-destructive/15 text-destructive' };
  if (row.entitled)
    return {
      label: row.plan === 'plus' ? 'Plus' : 'Cloud',
      className: 'bg-primary/15 text-primary',
    };
  // Comped without a paid subscription: that tier on the house.
  if (row.compedPlan)
    return {
      label: `comped · ${row.compedPlan === 'plus' ? 'Plus' : 'Cloud'}`,
      className: 'bg-primary/15 text-primary',
    };
  if (row.plan === 'free') {
    return { label: 'Free', className: 'bg-muted text-muted-foreground' };
  }
  return { label: row.status, className: 'bg-muted text-muted-foreground' };
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function AdminPage() {
  const mode = useLectorMode();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, u, a] = await Promise.all([getAdminSummary(), getAdminUsers(), getAuditLog()]);
      setSummary(s);
      // Most recent signups first; suspended float to the top for attention.
      setUsers(
        [...u].sort((a, b) => {
          if (a.suspended !== b.suspended) return a.suspended ? -1 : 1;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        }),
      );
      setAudit(a);
      setState('ready');
    } catch (err) {
      // The gated endpoints 403 for a non-admin; apiFetch surfaces that as a
      // non-ok response the data layer turns into a throw.
      const msg = err instanceof Error ? err.message : '';
      setState(/40[34]/.test(msg) ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    if (mode === 'cloud') load();
    else if (mode !== 'unknown') setState('forbidden');
  }, [mode, load]);

  const onSuspend = useCallback(
    async (row: AdminUserRow) => {
      const reason = window.prompt(`Suspend ${row.email}? Optional reason:`, '');
      if (reason === null) return; // cancelled
      setBusyId(row.id);
      try {
        await suspendUser(row.id, reason);
        toast.success(`Suspended ${row.email}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Suspend failed');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const onRestore = useCallback(
    async (row: AdminUserRow) => {
      setBusyId(row.id);
      try {
        await restoreUser(row.id);
        toast.success(`Restored ${row.email}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Restore failed');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const onExport = useCallback(async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      await exportUser(row.id, row.email);
      toast.success(`Exported ${row.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusyId(null);
    }
  }, []);

  const onToggleComp = useCallback(
    async (row: AdminUserRow) => {
      if (row.compedPlan) {
        setBusyId(row.id);
        try {
          await uncompUser(row.id);
          toast.success(`Revoked comp for ${row.email}`);
          await load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Comp change failed');
        } finally {
          setBusyId(null);
        }
        return;
      }
      // Not comped → pick a tier. cloud (base) or plus (premium allowances).
      const answer = window
        .prompt(`Comp ${row.email} a membership — type "cloud" or "plus":`, 'plus')
        ?.trim()
        .toLowerCase();
      if (!answer) return;
      if (answer !== 'cloud' && answer !== 'plus') {
        toast.error('Enter "cloud" or "plus".');
        return;
      }
      setBusyId(row.id);
      try {
        await compUser(row.id, answer, 'tester');
        toast.success(`Comped ${row.email} → ${answer === 'plus' ? 'Plus' : 'Cloud'}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Comp change failed');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  // Auth/support actions that just POST and reload. `confirm` gates the
  // destructive ones behind a browser confirm; the menu closes either way.
  const runAction = useCallback(
    async (
      row: AdminUserRow,
      fn: (id: string) => Promise<void>,
      label: string,
      confirmMsg?: string,
    ) => {
      setMenuId(null);
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusyId(row.id);
      try {
        await fn(row.id);
        toast.success(`${label} — ${row.email}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${label} failed`);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.name ?? '').toLowerCase().includes(q) ||
      (u.plan ?? '').includes(q) ||
      u.status.includes(q) ||
      (u.compedPlan ?? '').includes(q)
    );
  });

  if (state === 'loading') {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Admin" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (state === 'forbidden') {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Admin" />
        <p className="mb-4 text-muted-foreground">You don’t have access to this area.</p>
        <Link href="/" className="text-primary hover:underline">
          Return home
        </Link>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Admin" />
        <p className="mb-4 text-destructive">Failed to load the admin dashboard.</p>
        <button onClick={load} className="text-primary hover:underline">
          Retry
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title="Admin">
        <span className="text-sm text-muted-foreground">
          {summary ? `${summary.period} · today ${summary.dayPeriod}` : ''}
        </span>
      </PageHeader>

      {summary && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <StatCard
            label="Accounts"
            value={summary.users}
            hint={`${summary.verified} verified · ${summary.suspended} suspended`}
          />
          <StatCard
            label="Subscribers"
            value={summary.subscribers}
            hint={Object.entries(summary.byPlan)
              .map(([p, n]) => `${n} ${p}`)
              .join(' · ')}
          />
          <StatCard label="Free accounts" value={summary.freeAccounts} />
          <StatCard
            label="Managed glosses (mo)"
            value={
              summary.usageTracked ? summary.usageTotals.wordGlossesPerMonth.toLocaleString() : '—'
            }
            hint={
              summary.usageTracked
                ? `${summary.freeUsageTotals.wordGlossesPerMonth.toLocaleString()} from Free`
                : 'metering not deployed'
            }
          />
          <StatCard
            label="Phrase / context (day)"
            value={
              summary.usageTracked
                ? `${summary.usageTotals.phraseTranslationsPerDay.toLocaleString()} / ${summary.usageTotals.contextTranslationsPerDay.toLocaleString()}`
                : '—'
            }
            hint={
              summary.usageTracked
                ? `${summary.freeUsageTotals.phraseTranslationsPerDay.toLocaleString()} / ${summary.freeUsageTotals.contextTranslationsPerDay.toLocaleString()} from Free · ${summary.dayPeriod}`
                : summary.dayPeriod
            }
          />
          <StatCard
            label="Rich AI (mo)"
            value={summary.usageTracked ? summary.usageTotals.llmRequests.toLocaleString() : '—'}
          />
          <StatCard
            label="TTS chars (mo)"
            value={summary.usageTracked ? summary.usageTotals.ttsChars.toLocaleString() : '—'}
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email, name, plan, status…"
          className="w-72 max-w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {users.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Signed up</th>
              <th className="px-4 py-3 font-medium">Last active</th>
              <th className="px-4 py-3 font-medium">Library</th>
              <th className="px-4 py-3 font-medium">Managed usage</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const badge = planBadge(u);
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{u.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.emailVerified ? u.name || u.id : 'unverified'}
                    </div>
                    {u.suspended && u.suspendedReason && (
                      <div className="text-xs text-destructive">{u.suspendedReason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(u.lastActiveAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {u.library.lessons} lessons · {u.library.vocab} vocab
                    <div className="text-xs">{formatBytes(u.library.storageBytes)}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {u.usage.tracked ? (
                      <>
                        <div>
                          {u.usage.wordGlossesPerMonth.toLocaleString()} gloss/mo ·{' '}
                          {u.usage.phraseTranslationsPerDay.toLocaleString()} phrase/day ·{' '}
                          {u.usage.contextTranslationsPerDay.toLocaleString()} context/day
                        </div>
                        <div className="text-xs">
                          {u.usage.llmRequests.toLocaleString()} rich AI/mo ·{' '}
                          {u.usage.ttsChars.toLocaleString()} TTS chars/mo
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => onExport(u)}
                        disabled={busy}
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                      >
                        Export
                      </button>
                      <button
                        onClick={() => onToggleComp(u)}
                        disabled={busy}
                        className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                          u.compedPlan
                            ? 'border-border text-muted-foreground hover:bg-accent'
                            : 'border-primary/40 text-primary hover:bg-primary/10'
                        }`}
                        title="Comp a Cloud/Plus membership (bypasses billing)"
                      >
                        {u.compedPlan ? 'Un-comp' : 'Comp'}
                      </button>
                      {u.suspended ? (
                        <button
                          onClick={() => onRestore(u)}
                          disabled={busy}
                          className="rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => onSuspend(u)}
                          disabled={busy}
                          className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      )}
                      <div className="relative">
                        <button
                          onClick={() => setMenuId(menuId === u.id ? null : u.id)}
                          disabled={busy}
                          aria-label="More actions"
                          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                        >
                          ⋯
                        </button>
                        {menuId === u.id && (
                          <div className="absolute right-0 z-10 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                            {summary?.billingResyncAvailable && (
                              <MenuItem
                                onClick={() =>
                                  runAction(u, resyncPaddle, 'Billing resynced from Paddle')
                                }
                              >
                                Resync from Paddle
                              </MenuItem>
                            )}
                            <MenuItem
                              onClick={() =>
                                runAction(
                                  u,
                                  resetMfa,
                                  'MFA reset',
                                  `Reset 2FA for ${u.email}? They'll sign in without it and can re-enrol.`,
                                )
                              }
                            >
                              Reset MFA
                            </MenuItem>
                            <MenuItem
                              onClick={() => runAction(u, sendPasswordReset, 'Password reset sent')}
                            >
                              Send password reset
                            </MenuItem>
                            {!u.emailVerified && (
                              <>
                                <MenuItem
                                  onClick={() =>
                                    runAction(u, resendVerification, 'Verification sent')
                                  }
                                >
                                  Resend verification
                                </MenuItem>
                                <MenuItem
                                  onClick={() => runAction(u, forceVerify, 'Marked verified')}
                                >
                                  Mark verified
                                </MenuItem>
                              </>
                            )}
                            <MenuItem
                              destructive
                              onClick={() =>
                                runAction(
                                  u,
                                  revokeSessions,
                                  'Sessions revoked',
                                  `Sign ${u.email} out of all sessions?`,
                                )
                              }
                            >
                              Revoke sessions
                            </MenuItem>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Recent admin activity
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admin actions yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm">
                <span className="text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                <span className="font-medium text-foreground">{e.actorEmail ?? 'operator'}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {e.action}
                </span>
                {e.targetEmail && <span className="text-muted-foreground">→ {e.targetEmail}</span>}
                {e.detail && <span className="text-xs text-muted-foreground">({e.detail})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-xs font-medium hover:bg-accent ${
        destructive ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
