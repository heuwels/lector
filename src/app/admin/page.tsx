'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { useLectorMode } from '@/lib/use-env';
import {
  getAdminSummary,
  getAdminUsers,
  suspendUser,
  restoreUser,
  compUser,
  uncompUser,
  exportUser,
  type AdminSummary,
  type AdminUserRow,
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
  return { label: row.status, className: 'bg-muted text-muted-foreground' };
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
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
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([getAdminSummary(), getAdminUsers()]);
      setSummary(s);
      // Most recent signups first; suspended float to the top for attention.
      setUsers(
        [...u].sort((a, b) => {
          if (a.suspended !== b.suspended) return a.suspended ? -1 : 1;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        }),
      );
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
        <span className="text-sm text-muted-foreground">{summary?.period}</span>
      </PageHeader>

      {summary && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Accounts" value={summary.users} hint={`${summary.verified} verified`} />
          <StatCard
            label="Subscribers"
            value={summary.subscribers}
            hint={Object.entries(summary.byPlan)
              .map(([p, n]) => `${n} ${p}`)
              .join(' · ')}
          />
          <StatCard label="Suspended" value={summary.suspended} />
          <StatCard
            label="AI lookups (mo)"
            value={summary.usageTracked ? summary.usageTotals.llmRequests.toLocaleString() : '—'}
            hint={summary.usageTracked ? undefined : 'metering not deployed'}
          />
          <StatCard
            label="TTS chars (mo)"
            value={summary.usageTracked ? summary.usageTotals.ttsChars.toLocaleString() : '—'}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Signed up</th>
              <th className="px-4 py-3 font-medium">Last active</th>
              <th className="px-4 py-3 font-medium">Library</th>
              <th className="px-4 py-3 font-medium">Usage (mo)</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
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
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
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
                    {u.usage.tracked
                      ? `${u.usage.llmRequests.toLocaleString()} AI · ${u.usage.ttsChars.toLocaleString()} tts`
                      : '—'}
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
