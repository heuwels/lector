'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { stopImpersonation, type ImpersonationStatus } from '@/lib/admin-client';

/**
 * The persistent "Impersonating <email>" banner (#320). Rendered by the cloud
 * session gate whenever an impersonation grant is active, so it rides above
 * every page the operator visits while viewing as the user. Unmissable by
 * design: full-width, high-contrast, always on top. Exiting returns the
 * operator to their own account via a hard navigation to /admin (the tenant
 * caches are keyed by identity and flip on a full reload).
 */
function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ImpersonationBanner({ status }: { status: ImpersonationStatus }) {
  const expiresAt = status.expiresAt;
  const [label, setLabel] = useState(() => (expiresAt ? remaining(expiresAt) : ''));
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = remaining(expiresAt);
      setLabel(left);
      // The server treats an expired grant as inactive; once the clock runs
      // out, return the operator to the dashboard rather than leaving a stale
      // banner over what is now their own account again.
      if (new Date(expiresAt).getTime() <= Date.now()) window.location.assign('/admin');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const onExit = async () => {
    setExiting(true);
    try {
      await stopImpersonation();
    } catch {
      // Even if the stop call fails, leave the impersonated view — the operator
      // should never be stuck. The grant will also expire on its own.
      toast.error('Could not confirm exit; returning to admin anyway.');
    }
    window.location.assign('/admin');
  };

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <span>
        Viewing as <strong>{status.targetEmail ?? status.targetUserId}</strong> · read-only
        {label ? ` · ${label} left` : ''}
      </span>
      <button
        onClick={onExit}
        disabled={exiting}
        className="rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  );
}
