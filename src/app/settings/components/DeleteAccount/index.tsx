'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { useLectorMode } from '@/lib/use-env';

/**
 * Danger zone — permanent account + data deletion (#227, right-to-erasure).
 * Cloud-mode only: self-host runs as a single implicit local user with no
 * account to delete (mirrors AccountMenu's gate). This only KICKS OFF the flow
 * — Better Auth emails a confirmation link (deleteUser +
 * sendDeleteAccountVerification, api/src/lib/accounts.ts) and the tenant's data
 * is erased only when that link is clicked, so it works for password and
 * OAuth/OIDC accounts alike.
 */
const CONFIRM_PHRASE = 'DELETE';

export default function DeleteAccount() {
  const mode = useLectorMode();
  if (mode !== 'cloud') return null;
  return <DeleteAccountCard />;
}

function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const confirmed = phrase.trim() === CONFIRM_PHRASE;

  async function handleDelete() {
    if (submitting || !confirmed) return;
    setSubmitting(true);
    const { error } = await authClient.deleteUser({
      callbackURL: `${window.location.origin}/login?deleted=1`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message ?? 'Could not start account deletion. Please try again.');
      return;
    }
    setSent(true);
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-card p-6" data-testid="delete-account">
      <h2 className="mb-2 text-lg font-semibold text-destructive">Delete account</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Permanently delete your account and <strong>all</strong> of your data — books, vocabulary,
        cloze progress, journal entries, chat history, and settings. This cannot be undone, and is
        separate from exporting a backup above.
      </p>
      <p className="mb-4 text-sm text-muted-foreground">
        If you have a paid subscription, cancel it first: deleting your account here does{' '}
        <strong>not</strong> cancel billing (payments are handled by Paddle, our merchant of record
        — the manage-subscription link is in your Paddle receipt emails).
      </p>

      {sent ? (
        <div
          className="rounded-lg border border-border bg-[var(--primary-soft)] p-3 text-sm text-foreground"
          data-testid="delete-account-sent"
        >
          Check your email and open the link we just sent <strong>in this browser</strong> to
          permanently delete your account. The link expires in 24 hours.
        </div>
      ) : !open ? (
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          data-testid="delete-account-start"
        >
          Delete account…
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              data-testid="delete-account-confirm-input"
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="destructive"
              disabled={submitting || !confirmed}
              onClick={handleDelete}
              data-testid="delete-account-confirm"
            >
              {submitting ? 'Sending…' : 'Delete my account'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setPhrase('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
